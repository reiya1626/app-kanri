// app/experiment2/page.tsx
// 「アシスト機能なし（変換のみ）」版：
// - オブジェクト図（OD）を作る
// - 変換結果のクラス図（CD）を表示する
// - 診断／ヒント／正答例比較／問題文ハイライト等は表示しない

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";

// ===== 型 =====
type Slot = { key: string; value: string };
type Obj = { id: string; name: string; slots: Slot[] };
type Link = { id: string; from: string; to: string; label: string };

type ConvertResponse = {
  classPuml: string;
  encodedPuml: string;
};

type EditorPayload = {
  initialClassPuml?: string;
  snapshot?: { objects: Obj[]; links: Link[] };
};

// ===== 定数 =====
const STORAGE_KEY_STATE = "EXPERIMENT2_OBJECT_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT2_CLASS_EDITOR_INITIAL_V1";

const makeId = () => Math.random().toString(36).slice(2);

// ===== OD（オブジェクト図）Puml生成 =====
const stripHtmlTags = (s: string) => (s ?? "").replace(/<[^>]*>/g, "");

const formatSlotValueForPuml = (raw: string) => {
  const s = String(raw ?? "").trim();
  if (!s) return '""';
  const low = s.toLowerCase();
  if (low === "true" || low === "false") return low;
  if (/^[+-]?\d+$/.test(s)) return s;
  if (/^[+-]?\d+\.\d+$/.test(s)) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
};

const buildObjectDiagramPuml = (objs: Obj[], links: Link[]) => {
  if (!objs || objs.length === 0) return "";

  const aliasById = new Map<string, string>();
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("hide empty members");
  lines.push("skinparam shadowing false");

  let idx = 0;
  for (const o of objs) {
    const alias = `o${idx + 1}`;
    idx += 1;
    aliasById.set(o.id, alias);

    const name = String(o.name ?? "").trim() || "（未入力）";
    const safeName = name.replace(/"/g, '\\"');
    lines.push(`object "${safeName}" as ${alias}`);

    for (const sl of o.slots ?? []) {
      const key = String(sl.key ?? "").trim();
      if (!key) continue;
      const safeKey = key.replace(/"/g, '\\"');
      const value = formatSlotValueForPuml(sl.value ?? "");
      lines.push(`${alias} : ${safeKey} = ${value}`);
    }
  }

  for (const l of links ?? []) {
    const a = aliasById.get(l.from);
    const b = aliasById.get(l.to);
    if (!a || !b) continue;
    const label = stripHtmlTags(String(l.label ?? "")).trim().replace(/"/g, '\\"');
    if (label) lines.push(`${a} -- ${b} : ${label}`);
    else lines.push(`${a} -- ${b}`);
  }

  lines.push("@enduml");
  return lines.join("\n");
};

/**
 * 推定クラス図の関連が点線(..)で出る場合があるため，
 * 関係オペレータだけを実線（--）へ寄せる（多重度 0..* は引用符つきなので影響しない）
 */
const forceSolidRelations = (puml: string) => {
  if (!puml) return puml;
  const lines = puml.split(/\r?\n/);

  const shouldSkipLine = (t: string) => {
    if (!t) return true;
    if (t.startsWith("'")) return true;
    if (/^(?:@startuml|@enduml|skinparam|hide|show|title|left to right direction)\b/i.test(t)) return true;
    return false;
  };

  const isRelationOpToken = (tok: string) => /^[.\-o*<>()\/\\|><]+$/.test(tok) && tok.includes(".");

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (shouldSkipLine(trimmed)) return line;
      const parts = line.split(/(\s+)/);
      let changed = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p || /^\s+$/.test(p)) continue;
        if (!isRelationOpToken(p)) continue;
        parts[i] = p.replace(/\./g, "-");
        changed = true;
      }
      return changed ? parts.join("") : line;
    })
    .join("\n");
};

export default function Experiment2Page() {
  const router = useRouter();

  // ===== state =====
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  const [encodedObjectPuml, setEncodedObjectPuml] = useState<string>("");
  const [classPuml, setClassPuml] = useState<string>("");
  const [encodedClassPuml, setEncodedClassPuml] = useState<string>("");

  const [odZoom, setOdZoom] = useState<number>(1);
  const [cdZoom, setCdZoom] = useState<number>(1);

  // ===== 起動時：復元 =====
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      if (Array.isArray(parsed.objects)) setObjects(parsed.objects);
      if (Array.isArray(parsed.links)) setLinks(parsed.links);
    } catch {
      // ignore
    }
  }, []);

  // ===== 保存（編集ごと） =====
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    } catch {
      // ignore
    }
  }, [objects, links]);

  const hasUnnamedObject = useMemo(() => objects.some((o) => !String(o.name ?? "").trim()), [objects]);

  // ===== ODプレビュー =====
  useEffect(() => {
    const puml = buildObjectDiagramPuml(objects, links);
    if (!puml) {
      setEncodedObjectPuml("");
      return;
    }
    try {
      setEncodedObjectPuml(plantumlEncoder.encode(puml));
    } catch {
      setEncodedObjectPuml("");
    }
  }, [objects, links]);

  const odPreviewUrl = useMemo(
    () => (encodedObjectPuml ? `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}` : ""),
    [encodedObjectPuml]
  );

  // ===== CDプレビュー（変換） =====
  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
      setClassPuml("");
      setEncodedClassPuml("");
      return;
    }
    if (hasUnnamedObject) {
      setClassPuml("");
      setEncodedClassPuml("");
      return;
    }

    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: objects.map((o) => ({
              name: o.name,
              attrs: o.slots.map((s) => ({ key: s.key, value: s.value })),
            })),
            links: links.map((l) => {
              const fromObj = objects.find((o) => o.id === l.from);
              const toObj = objects.find((o) => o.id === l.to);
              return { from: fromObj?.name ?? "", to: toObj?.name ?? "", label: l.label };
            }),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as ConvertResponse;
        const solid = forceSolidRelations(data.classPuml);
        setClassPuml(solid);
        try {
          setEncodedClassPuml(plantumlEncoder.encode(solid));
        } catch {
          setEncodedClassPuml("");
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // ignore
      }
    }, 500);

    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [objects, links, hasUnnamedObject]);

  const cdPreviewUrl = useMemo(
    () => (encodedClassPuml ? `https://www.plantuml.com/plantuml/svg/${encodedClassPuml}` : ""),
    [encodedClassPuml]
  );

  const selectedObject = useMemo(() => objects.find((o) => o.id === selectedObjectId) ?? null, [objects, selectedObjectId]);
  const selectedLink = useMemo(() => links.find((l) => l.id === selectedLinkId) ?? null, [links, selectedLinkId]);

  // ===== 操作 =====
  const addObject = () => {
    const id = makeId();
    setObjects((prev) => [...prev, { id, name: "", slots: [] }]);
    setSelectedObjectId(id);
    setSelectedLinkId(null);
  };

  const deleteObject = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setLinks((prev) => prev.filter((l) => l.from !== id && l.to !== id));
    if (selectedObjectId === id) setSelectedObjectId(null);
  };

  const addSlot = (objId: string) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === objId ? { ...o, slots: [...o.slots, { key: "", value: "" }] } : o))
    );
  };

  const updateSlot = (objId: string, idx: number, patch: Partial<Slot>) => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== objId) return o;
        const next = [...o.slots];
        next[idx] = { ...next[idx], ...patch };
        return { ...o, slots: next };
      })
    );
  };

  const deleteSlot = (objId: string, idx: number) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === objId ? { ...o, slots: o.slots.filter((_, i) => i !== idx) } : o))
    );
  };

  const addLink = () => {
    if (objects.length < 2) return;
    const id = makeId();
    const from = objects[0].id;
    const to = objects[1].id;
    setLinks((prev) => [...prev, { id, from, to, label: "" }]);
    setSelectedLinkId(id);
    setSelectedObjectId(null);
  };

  const updateLink = (id: string, patch: Partial<Link>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const deleteLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    if (selectedLinkId === id) setSelectedLinkId(null);
  };

  const resetAll = () => {
    if (!confirm("すべてリセットします．よろしいですか？")) return;
    setObjects([]);
    setLinks([]);
    setSelectedObjectId(null);
    setSelectedLinkId(null);
    setClassPuml("");
    setEncodedClassPuml("");
    try {
      window.localStorage.removeItem(STORAGE_KEY_STATE);
    } catch {
      // ignore
    }
  };

  const goToClassEditor = async () => {
    if (hasUnnamedObject) {
      alert("オブジェクト名が未入力のものがあります．名前を入れてから進んでください．");
      return;
    }
    if (!classPuml) {
      alert("クラス図がまだ生成されていません．");
      return;
    }
    const payload: EditorPayload = {
      initialClassPuml: classPuml,
      snapshot: { objects: structuredClone(objects), links: structuredClone(links) },
    };
    try {
      window.localStorage.setItem(STORAGE_KEY_EDITOR_INITIAL, JSON.stringify(payload));
    } catch {
      // ignore
    }
    router.push("/experiment2/class-editor");
  };

  return (
    <div className="min-h-screen p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">experiment2（変換のみ）</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm" onClick={resetAll}>
            すべてリセット
          </button>
          <button className="px-3 py-1 rounded bg-emerald-100 text-emerald-800 font-semibold hover:bg-emerald-200 text-sm" onClick={goToClassEditor}>
            クラス図の編集へ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* 左：OD入力 */}
        <div className="col-span-5 border rounded p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">オブジェクト図（入力）</div>
            <button className="px-2 py-1 rounded bg-sky-100 text-sky-800 hover:bg-sky-200 text-sm" onClick={addObject}>
              ＋ オブジェクト追加
            </button>
          </div>

          <div className="mt-3 grid grid-cols-12 gap-3">
            <div className="col-span-5 border rounded h-[420px] overflow-auto">
              {objects.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">左上の「＋ オブジェクト追加」から開始します．</div>
              ) : (
                objects.map((o) => (
                  <div
                    key={o.id}
                    className={`px-2 py-1 border-b text-sm cursor-pointer hover:bg-slate-50 ${
                      selectedObjectId === o.id ? "bg-sky-50" : ""
                    }`}
                    onClick={() => {
                      setSelectedObjectId(o.id);
                      setSelectedLinkId(null);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate">{o.name || "（未入力）"}</div>
                      <div className="ml-auto text-[11px] text-slate-500">{o.slots.length} 属性</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="col-span-7">
              {selectedObject ? (
                <div className="border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm">オブジェクトの編集</div>
                    <button
                      className="px-2 py-1 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 text-sm"
                      onClick={() => deleteObject(selectedObject.id)}
                    >
                      このオブジェクトを削除
                    </button>
                  </div>

                  <label className="text-[12px] font-semibold">オブジェクト名</label>
                  <input
                    className="w-full border rounded px-2 py-1 text-sm mt-1"
                    value={selectedObject.name}
                    placeholder="例）利用者A"
                    onChange={(e) =>
                      setObjects((prev) => prev.map((o) => (o.id === selectedObject.id ? { ...o, name: e.target.value } : o)))
                    }
                  />

                  <div className="mt-3 flex items-center justify-between">
                    <div className="font-semibold text-sm">属性</div>
                    <button
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
                      onClick={() => addSlot(selectedObject.id)}
                    >
                      ＋ 属性を追加
                    </button>
                  </div>

                  {selectedObject.slots.length === 0 ? (
                    <div className="mt-2 text-sm text-slate-500">属性は任意です．</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2">
                      {selectedObject.slots.map((sl, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            className="col-span-5 border rounded px-2 py-1 text-sm"
                            placeholder="属性名（例：氏名）"
                            value={sl.key}
                            onChange={(e) => updateSlot(selectedObject.id, idx, { key: e.target.value })}
                          />
                          <input
                            className="col-span-5 border rounded px-2 py-1 text-sm"
                            placeholder="値（例：佐藤）"
                            value={sl.value}
                            onChange={(e) => updateSlot(selectedObject.id, idx, { value: e.target.value })}
                          />
                          <button
                            className="col-span-2 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
                            onClick={() => deleteSlot(selectedObject.id, idx)}
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="border rounded p-3 text-sm text-slate-500">左の一覧からオブジェクトを選択します．</div>
              )}

              <div className="mt-3 border rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">リンク</div>
                  <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm" onClick={addLink}>
                    ＋ リンク追加
                  </button>
                </div>

                {links.length === 0 ? (
                  <div className="mt-2 text-sm text-slate-500">リンクは任意です．</div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {links.map((l) => (
                      <div
                        key={l.id}
                        className={`border rounded p-2 text-sm cursor-pointer ${selectedLinkId === l.id ? "bg-sky-50" : "hover:bg-slate-50"}`}
                        onClick={() => {
                          setSelectedLinkId(l.id);
                          setSelectedObjectId(null);
                        }}
                      >
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <select
                            className="col-span-4 border rounded px-2 py-1 text-sm"
                            value={l.from}
                            onChange={(e) => updateLink(l.id, { from: e.target.value })}
                          >
                            {objects.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name || "（未入力）"}
                              </option>
                            ))}
                          </select>
                          <div className="col-span-1 text-center">→</div>
                          <select
                            className="col-span-4 border rounded px-2 py-1 text-sm"
                            value={l.to}
                            onChange={(e) => updateLink(l.id, { to: e.target.value })}
                          >
                            {objects.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name || "（未入力）"}
                              </option>
                            ))}
                          </select>
                          <input
                            className="col-span-2 border rounded px-2 py-1 text-sm"
                            placeholder="ラベル"
                            value={l.label}
                            onChange={(e) => updateLink(l.id, { label: e.target.value })}
                          />
                          <button
                            className="col-span-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
                            onClick={() => deleteLink(l.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 右：プレビュー */}
        <div className="col-span-7 grid grid-cols-12 gap-3">
          <div className="col-span-6 border rounded p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">オブジェクト図（プレビュー）</div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">{Math.round(odZoom * 100)}%</span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={Math.round(odZoom * 100)}
                  onChange={(e) => setOdZoom(Number(e.target.value) / 100)}
                />
                <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setOdZoom(1)}>
                  100%
                </button>
              </div>
            </div>

            <div className="mt-2 border rounded h-[520px] overflow-auto bg-white">
              {odPreviewUrl ? (
                <div style={{ zoom: odZoom as any }} className="p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={odPreviewUrl} alt="object diagram" className="max-w-none" />
                </div>
              ) : (
                <div className="p-3 text-sm text-slate-500">まだ表示できる内容がありません．</div>
              )}
            </div>
          </div>

          <div className="col-span-6 border rounded p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">クラス図（プレビュー）</div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">{Math.round(cdZoom * 100)}%</span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={Math.round(cdZoom * 100)}
                  onChange={(e) => setCdZoom(Number(e.target.value) / 100)}
                />
                <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setCdZoom(1)}>
                  100%
                </button>
              </div>
            </div>

            <div className="mt-2 border rounded h-[520px] overflow-auto bg-white">
              {hasUnnamedObject ? (
                <div className="p-3 text-sm text-slate-500">オブジェクト名が未入力のため，変換結果は表示しません．</div>
              ) : cdPreviewUrl ? (
                <div style={{ zoom: cdZoom as any }} className="p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cdPreviewUrl} alt="class diagram" className="max-w-none" />
                </div>
              ) : (
                <div className="p-3 text-sm text-slate-500">まだ変換結果がありません．</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
