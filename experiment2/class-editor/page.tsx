// app/experiment2/class-editor/page.tsx
// 「アシスト機能なし（変換のみ）」版：
// - 変換結果のクラス図を編集できる最小UI
// - フィードバック／ヒント／問題文ハイライト／?ヘルプ等は表示しない

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";

type ClassAttr = { id: string; name: string; type: string };
type ClassInfo = { id: string; name: string; attrs: ClassAttr[] };

type Relation = {
  id: string;
  fromClassId: string;
  toClassId: string;
  label: string;
  leftMultiplicity: string;
  rightMultiplicity: string;
};

type Slot = { key: string; value: string };
type Obj = { id: string; name: string; slots: Slot[] };
type Link = { id: string; from: string; to: string; label: string };

type EditorPayload = {
  initialClassPuml?: string;
  snapshot?: { objects: Obj[]; links: Link[] };
};

const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT2_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT2_CLASS_EDITOR_INITIAL_V1";

const makeId = () => Math.random().toString(36).slice(2);
const esc = (s: string) => (s ?? "").replace(/"/g, "\\\"");

// ===== 多重度：入力が途中っぽいときはプレビューを抑制（初学者が混乱しないため） =====
const isValidMultiplicity = (raw: string) => {
  const s = String(raw ?? "").trim();
  if (!s) return true; // 未入力はOK（出力しない）
  if (/^\d+$/.test(s)) return true; // 1
  if (/^\d+\.\.\d+$/.test(s)) return true; // 1..2
  if (/^\d+\.\.\*$/.test(s)) return true; // 0..*
  if (/^\*$/.test(s)) return true; // *
  return false;
};

// ===== 初期PUMLパース（convert API の出力フォーマットに合わせた軽量版） =====
const parseInitialClassPuml = (puml: string): { classes: ClassInfo[]; relations: Relation[] } => {
  const classes: ClassInfo[] = [];
  const relations: Relation[] = [];
  if (!puml) return { classes, relations };

  const lines = puml.split(/\r?\n/);
  const classByName = new Map<string, ClassInfo>();

  let current: ClassInfo | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^@startuml/i.test(t) || /^@enduml/i.test(t)) continue;
    if (/^skinparam\b/i.test(t) || /^hide\b/i.test(t)) continue;

    // class <name> <<stereo>> {
    const mClass = t.match(/^class\s+(.+?)(?:\s+<<[^>]+>>)?\s*\{$/);
    if (mClass) {
      const name = mClass[1].trim();
      const ci: ClassInfo = { id: makeId(), name, attrs: [] };
      classes.push(ci);
      classByName.set(name, ci);
      current = ci;
      continue;
    }
    if (t === "}") {
      current = null;
      continue;
    }
    // attr line: key: type ...
    if (current) {
      const mAttr = t.match(/^(.+?)\s*:\s*([A-Za-z_][\w]*)\b/);
      if (mAttr) {
        const key = mAttr[1].trim();
        const ty = mAttr[2].trim();
        current.attrs.push({ id: makeId(), name: key, type: ty });
      }
      continue;
    }

    // relation: A "0..*" -- "0..*" B : label
    const mRel = t.match(/^(.+?)\s+"([^"]*)"\s+(\.{2}|--?)\s+"([^"]*)"\s+(.+?)(?:\s*:\s*(.+))?$/);
    if (mRel) {
      const a = mRel[1].trim();
      const left = mRel[2].trim();
      const right = mRel[4].trim();
      const b = mRel[5].trim();
      const label = (mRel[6] ?? "").trim();
      // class がまだ無ければ作る（念のため）
      const ca = classByName.get(a) ?? (() => {
        const ci: ClassInfo = { id: makeId(), name: a, attrs: [] };
        classes.push(ci);
        classByName.set(a, ci);
        return ci;
      })();
      const cb = classByName.get(b) ?? (() => {
        const ci: ClassInfo = { id: makeId(), name: b, attrs: [] };
        classes.push(ci);
        classByName.set(b, ci);
        return ci;
      })();

      relations.push({
        id: makeId(),
        fromClassId: ca.id,
        toClassId: cb.id,
        label,
        leftMultiplicity: left,
        rightMultiplicity: right,
      });
    }
  }

  return { classes, relations };
};

const buildClassDiagramPuml = (classes: ClassInfo[], relations: Relation[]) => {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("hide empty members");
  lines.push("skinparam classAttributeIconSize 0");

  for (const c of classes) {
    const cname = esc(c.name || "（未入力）");
    lines.push(`class "${cname}" as C_${c.id.replace(/[^a-zA-Z0-9_]/g, "")} {`);
    for (const a of c.attrs) {
      const an = String(a.name ?? "").trim();
      if (!an) continue;
      const at = String(a.type ?? "string").trim() || "string";
      lines.push(`  ${esc(an)}: ${at}`);
    }
    lines.push("}");
  }

  const byId = new Map(classes.map((c) => [c.id, c] as const));
  for (const r of relations) {
    const a = byId.get(r.fromClassId);
    const b = byId.get(r.toClassId);
    if (!a || !b) continue;

    const aAlias = `C_${a.id.replace(/[^a-zA-Z0-9_]/g, "")}`;
    const bAlias = `C_${b.id.replace(/[^a-zA-Z0-9_]/g, "")}`;

    const left = String(r.leftMultiplicity ?? "").trim();
    const right = String(r.rightMultiplicity ?? "").trim();
    const label = String(r.label ?? "").trim();

    const leftPart = left ? ` "${esc(left)}"` : "";
    const rightPart = right ? ` "${esc(right)}"` : "";
    const labelPart = label ? ` : ${esc(label)}` : "";

    // 片側だけの多重度も許容する
    // - 両方あり: A "x" -- "y" B
    // - 左だけ:  A "x" -- B
    // - 右だけ:  A -- "y" B
    let relLine = "";
    if (left && right) relLine = `${aAlias}${leftPart} --${rightPart} ${bAlias}${labelPart}`;
    else if (left && !right) relLine = `${aAlias}${leftPart} -- ${bAlias}${labelPart}`;
    else if (!left && right) relLine = `${aAlias} --${rightPart} ${bAlias}${labelPart}`;
    else relLine = `${aAlias} -- ${bAlias}${labelPart}`;

    lines.push(relLine);
  }

  lines.push("@enduml");
  return lines.join("\n");
};

export default function ClassEditor2Page() {
  const router = useRouter();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [cdZoom, setCdZoom] = useState(1);

  // 画面内編集の途中で PlantUML エラーを出さないための抑制
  const [suppressPreview, setSuppressPreview] = useState(false);

  // 初期ロード
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (raw) {
        const st = JSON.parse(raw) as { classes: ClassInfo[]; relations: Relation[]; selectedClassId?: string };
        if (Array.isArray(st.classes)) setClasses(st.classes);
        if (Array.isArray(st.relations)) setRelations(st.relations);
        if (st.selectedClassId) setSelectedClassId(st.selectedClassId);
        return;
      }
    } catch {}

    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (raw) {
        const payload = JSON.parse(raw) as EditorPayload;
        const parsed = parseInitialClassPuml(payload.initialClassPuml ?? "");
        setClasses(parsed.classes);
        setRelations(parsed.relations);
        if (parsed.classes[0]) setSelectedClassId(parsed.classes[0].id);
      }
    } catch {}
  }, []);

  // state 保存
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_EDITOR_STATE,
        JSON.stringify({ classes, relations, selectedClassId })
      );
    } catch {}
  }, [classes, relations, selectedClassId]);


  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );

  // 多重度入力中はプレビューを抑制（クラス名編集と同じ思想）
  useEffect(() => {
    const anyInvalid = relations.some((r) => !isValidMultiplicity(r.leftMultiplicity) || !isValidMultiplicity(r.rightMultiplicity));
    if (!anyInvalid) {
      setSuppressPreview(false);
      return;
    }
    setSuppressPreview(true);
    const id = setTimeout(() => setSuppressPreview(false), 600);
    return () => clearTimeout(id);
  }, [relations]);

  const puml = useMemo(() => buildClassDiagramPuml(classes, relations), [classes, relations]);
  const encodedPuml = useMemo(() => {
    if (suppressPreview) return "";
    try {
      return plantumlEncoder.encode(puml);
    } catch {
      return "";
    }
  }, [puml, suppressPreview]);

  const previewUrl = useMemo(() => (encodedPuml ? `https://www.plantuml.com/plantuml/svg/${encodedPuml}` : ""), [encodedPuml]);

  const addClass = () => {
    const c: ClassInfo = { id: makeId(), name: "クラス名未定", attrs: [] };
    setClasses((prev) => [...prev, c]);
    setSelectedClassId(c.id);
  };

  const deleteClass = (id: string) => {
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) => prev.filter((r) => r.fromClassId !== id && r.toClassId !== id));
    setSelectedClassId((cur) => {
      if (cur !== id) return cur;
      const next = classes.find((c) => c.id !== id);
      return next?.id ?? "";
    });
  };

  const addAttr = (classId: string) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? { ...c, attrs: [...c.attrs, { id: makeId(), name: "", type: "string" }] }
          : c
      )
    );
  };

  const addRelation = () => {
    const a = classes[0]?.id;
    const b = classes[1]?.id ?? classes[0]?.id;
    if (!a || !b) return;
    setRelations((prev) => [
      ...prev,
      {
        id: makeId(),
        fromClassId: a,
        toClassId: b,
        label: "",
        leftMultiplicity: "",
        rightMultiplicity: "",
      },
    ]);
  };

  const resetAll = () => {
    if (!confirm("すべてリセットします．よろしいですか？")) return;
    setClasses([]);
    setRelations([]);
    setSelectedClassId("");
    try {
      localStorage.removeItem(STORAGE_KEY_EDITOR_STATE);
    } catch {}
  };

  const multOptions = ["1", "0..1", "0..*", "1..*", "1..2"];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button className="text-sm px-2 py-1 border rounded" onClick={() => router.push("/experiment2")}
          aria-label="back">
          ← オブジェクト図へ戻る
        </button>
        <div className="flex items-center gap-2">
          <button className="text-sm px-2 py-1 border rounded bg-white" onClick={resetAll}>すべてリセット</button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* 左：クラス */}
        <div className="col-span-4 border rounded bg-white overflow-hidden">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">クラス</div>
            <button className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold" onClick={addClass}>
              ＋ 追加
            </button>
          </div>
          <div className="grid grid-cols-5 min-h-[520px]">
            <div className="col-span-2 border-r">
              {classes.length === 0 ? (
                <div className="p-2 text-[12px] text-slate-500">クラスがありません．</div>
              ) : (
                classes.map((c) => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-2 py-1 text-[12px] border-b hover:bg-slate-50 ${c.id === selectedClassId ? "bg-sky-50" : ""}`}
                    onClick={() => setSelectedClassId(c.id)}
                  >
                    <div className="truncate">{c.name || "（未入力）"}</div>
                    <div className="text-[10px] text-slate-500">{c.attrs.length} 属性</div>
                  </button>
                ))
              )}
            </div>
            <div className="col-span-3 p-2">
              {!selectedClass ? (
                <div className="text-[12px] text-slate-500">左からクラスを選んでください．</div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-semibold">クラス名</label>
                    <button
                      className="text-[12px] px-2 py-0.5 rounded bg-rose-100 text-rose-700"
                      onClick={() => deleteClass(selectedClass.id)}
                    >
                      このクラスを削除
                    </button>
                  </div>
                  <input
                    className="mt-1 w-full border rounded px-2 py-1 text-[12px]"
                    value={selectedClass.name}
                    onChange={(e) =>
                      setClasses((prev) => prev.map((c) => (c.id === selectedClass.id ? { ...c, name: e.target.value } : c)))
                    }
                  />

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[12px] font-semibold">属性</div>
                    <button
                      className="text-[12px] px-2 py-0.5 rounded bg-slate-100"
                      onClick={() => addAttr(selectedClass.id)}
                    >
                      ＋ 追加
                    </button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {selectedClass.attrs.map((a) => (
                      <div key={a.id} className="flex items-center gap-2">
                        <input
                          className="flex-1 border rounded px-2 py-1 text-[12px]"
                          placeholder="属性名"
                          value={a.name}
                          onChange={(e) =>
                            setClasses((prev) =>
                              prev.map((c) =>
                                c.id !== selectedClass.id
                                  ? c
                                  : {
                                      ...c,
                                      attrs: c.attrs.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)),
                                    }
                              )
                            )
                          }
                        />
                        <select
                          className="border rounded px-2 py-1 text-[12px]"
                          value={a.type}
                          onChange={(e) =>
                            setClasses((prev) =>
                              prev.map((c) =>
                                c.id !== selectedClass.id
                                  ? c
                                  : {
                                      ...c,
                                      attrs: c.attrs.map((x) => (x.id === a.id ? { ...x, type: e.target.value } : x)),
                                    }
                              )
                            )
                          }
                        >
                          <option value="string">string</option>
                          <option value="int">int</option>
                          <option value="real">real</option>
                          <option value="boolean">boolean</option>
                        </select>
                        <button
                          className="text-[12px] px-2 py-1 rounded bg-slate-100"
                          onClick={() =>
                            setClasses((prev) =>
                              prev.map((c) =>
                                c.id !== selectedClass.id
                                  ? c
                                  : { ...c, attrs: c.attrs.filter((x) => x.id !== a.id) }
                              )
                            )
                          }
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 中：関連 */}
        <div className="col-span-4 border rounded bg-white overflow-hidden">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">関連</div>
            <button className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold" onClick={addRelation}>
              ＋ 追加
            </button>
          </div>
          <div className="p-2 space-y-2 min-h-[520px]">
            {relations.length === 0 ? (
              <div className="text-[12px] text-slate-500">関連がありません．</div>
            ) : (
              relations.map((r) => (
                <div key={r.id} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold">端点と多重度</div>
                    <button
                      className="text-[12px] px-2 py-0.5 rounded bg-slate-100"
                      onClick={() => setRelations((prev) => prev.filter((x) => x.id !== r.id))}
                    >
                      削除
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-[12px]"
                      value={r.fromClassId}
                      onChange={(e) => setRelations((prev) => prev.map((x) => (x.id === r.id ? { ...x, fromClassId: e.target.value } : x)))}
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || "（未入力）"}
                        </option>
                      ))}
                    </select>

                    <input
                      className="w-20 border rounded px-2 py-1 text-[12px]"
                      placeholder="例）0..*"
                      list={`multopt-${r.id}-l`}
                      value={r.leftMultiplicity}
                      onChange={(e) => setRelations((prev) => prev.map((x) => (x.id === r.id ? { ...x, leftMultiplicity: e.target.value } : x)))}
                    />
                    <datalist id={`multopt-${r.id}-l`}>
                      {multOptions.map((m) => (
                        <option value={m} key={m} />
                      ))}
                    </datalist>

                    <span className="text-[12px]">—</span>

                    <input
                      className="w-20 border rounded px-2 py-1 text-[12px]"
                      placeholder="例）0..*"
                      list={`multopt-${r.id}-r`}
                      value={r.rightMultiplicity}
                      onChange={(e) => setRelations((prev) => prev.map((x) => (x.id === r.id ? { ...x, rightMultiplicity: e.target.value } : x)))}
                    />
                    <datalist id={`multopt-${r.id}-r`}>
                      {multOptions.map((m) => (
                        <option value={m} key={m} />
                      ))}
                    </datalist>

                    <select
                      className="border rounded px-2 py-1 text-[12px]"
                      value={r.toClassId}
                      onChange={(e) => setRelations((prev) => prev.map((x) => (x.id === r.id ? { ...x, toClassId: e.target.value } : x)))}
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || "（未入力）"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-2">
                    <label className="text-[12px] font-semibold">関連名</label>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-[12px]"
                      placeholder="例）借りる"
                      value={r.label}
                      onChange={(e) => setRelations((prev) => prev.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))}
                    />
                  </div>
                </div>
              ))
            )}

            {suppressPreview && (
              <div className="text-[12px] text-slate-500">
                入力中のため，プレビューは入力が整ったら表示します．
              </div>
            )}
          </div>
        </div>

        {/* 右：プレビュー */}
        <div className="col-span-4 border rounded bg-white overflow-hidden">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">クラス図（プレビュー）</div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-600">{Math.round(cdZoom * 100)}%</span>
              <input
                type="range"
                min={0.5}
                max={1.8}
                step={0.1}
                value={cdZoom}
                onChange={(e) => setCdZoom(parseFloat(e.target.value))}
              />
              <button className="text-[12px] px-2 py-1 border rounded" onClick={() => setCdZoom(1)}>
                100%
              </button>
            </div>
          </div>
          <div className="h-[560px] overflow-auto">
            {suppressPreview ? (
              <div className="p-3 text-[12px] text-slate-500">入力中のため，プレビューは入力が整ったら表示します．</div>
            ) : previewUrl ? (
              <div style={{ zoom: cdZoom as any }} className="p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="class diagram" className="max-w-none" />
              </div>
            ) : (
              <div className="p-3 text-[12px] text-slate-500">プレビューを生成できませんでした．</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
