// app/experiment/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../components/problem-config";

// ===== 型定義 =====
type Slot = {
  key: string;
  value: string;
};

type Obj = {
  id: string;
  name: string;
  slots: Slot[];
};

type Link = {
  id: string;
  from: string; // Obj.id
  to: string;   // Obj.id
  label: string;
};

type IssuesResponse = {
  classes: {
    name: string;
    incomplete: string[];
    contradictory: string[];
  }[];
};

type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};

type ConvertResponse = {
  classPuml: string;
  encodedPuml: string;
  issues?: IssuesResponse;
  relationHints?: RelationHint[];
};

type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  snapshot?: {
    objects: Obj[];
    links: Link[];
  };
};

const STORAGE_KEY_STATE = "EXPERIMENT_OBJECT_EDITOR_STATE";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// ===== ユーティリティ（オブジェクト図用フォーマット） =====
type PrimType = "int" | "real" | "boolean" | "string";

const detectType = (v: string): PrimType => {
  const t = v.trim().replace(/^[[\s\n\r\t"']+|[\s\n\r\t"']+$/g, "");
  if (/^-?\d+$/.test(t)) return "int";
  if (/^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t)) return "real";
  if (/^(?:true|false)$/i.test(t)) return "boolean";
  return "string";
};

const escLabel = (s: string) => s.replace(/"/g, '\\"');

const formatSlotValue = (raw: string): string => {
  const t = raw.trim();
  if (!t) return "";
  const ty = detectType(t);
  if (ty === "int" || ty === "real") return t;
  if (ty === "boolean") return t.toLowerCase();
  // string のときだけ "...":
  return `"${escLabel(t)}"`;
};

// ===== メインコンポーネント =====
const ExperimentPage: React.FC = () => {
  const router = useRouter();

  // 教員トップ画面で設定された問題文を取得
  const { classProblemText, objectProblemText } = useProblemConfig();

  // --- オブジェクト／リンクの状態 ---
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // --- プレビュー（PlantUML） ---
  const [encodedObjectPuml, setEncodedObjectPuml] = useState<string>("");
  const [classPuml, setClassPuml] = useState<string>("");
  const [encodedClassPuml, setEncodedClassPuml] = useState<string>("");
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);

  // --- 問題文の表示制御 ---
  const [showClassProblemFull, setShowClassProblemFull] = useState(false);
  const [showObjectProblemFull, setShowObjectProblemFull] = useState(false);

  // ===== ローカルストレージからの読み込み =====
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        objects?: Obj[];
        links?: Link[];
      };
      if (parsed.objects) setObjects(parsed.objects);
      if (parsed.links) setLinks(parsed.links);
    } catch {
      // 無視
    }
  }, []);

  // ===== オブジェクト図 PlantUML の生成（リアルタイム） =====
  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
      setEncodedObjectPuml("");
      return;
    }

    // どのオブジェクトをハイライトするか決定
    const objectHighlightIds = new Set<string>(); // オブジェクト選択による強調（黄色）
    const linkHighlightIds = new Set<string>();   // リンク選択による強調（ピンク）

    if (selectedObjectId) objectHighlightIds.add(selectedObjectId);
    const currentLink = links.find((l) => l.id === selectedLinkId) ?? null;
    if (currentLink) {
      linkHighlightIds.add(currentLink.from);
      linkHighlightIds.add(currentLink.to);
    }

    const lines: string[] = [];
    lines.push("@startuml");

    // オブジェクト
    for (const o of objects) {
      const safeName = o.name || "(無名)";
      const underlined = `<u>${escLabel(safeName)}</u>`;

      let fill = "";
      if (objectHighlightIds.has(o.id)) {
        // オブジェクトを選択中 → 黄色
        fill = " #FFF6BF";
      } else if (linkHighlightIds.has(o.id)) {
        // リンクを選択中 → ピンク
        fill = " #FFD6E0";
      }

      lines.push(`object "${underlined}" as ${o.id}${fill} {`);
      for (const s of o.slots) {
        if (!s.key && !s.value) continue;
        const val = formatSlotValue(s.value);
        const display = val ? `${s.key}: ${val}` : s.key;
        lines.push(`  ${display}`);
      }
      lines.push("}");
    }

    // リンク（選択されているものだけ赤線）
    for (const l of links) {
      const from = objects.find((o) => o.id === l.from);
      const to = objects.find((o) => o.id === l.to);
      if (!from || !to) continue;
      const labelPart = l.label ? ` : ${escLabel(l.label)}` : "";
      const isHighlighted = l.id === selectedLinkId;
      const linePattern = isHighlighted ? "-[#red]-" : "--";
      lines.push(`${from.id} ${linePattern} ${to.id}${labelPart}`);
    }

    lines.push("@enduml");
    const puml = lines.join("\n");

    try {
      const encoded = plantumlEncoder.encode(puml);
      setEncodedObjectPuml(encoded);
    } catch {
      setEncodedObjectPuml("");
    }
  }, [objects, links, selectedObjectId, selectedLinkId]);

  // ===== 推定クラス図のリアルタイム更新 =====
  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
      setClassPuml("");
      setEncodedClassPuml("");
      setIssues(null);
      setRelationHints([]);
      return;
    }

    const controller = new AbortController();
    const id = setTimeout(async () => {
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
              return {
                from: fromObj?.name ?? "",
                to: toObj?.name ?? "",
                label: l.label,
              };
            }),
          }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data = (await res.json()) as ConvertResponse;
        setClassPuml(data.classPuml);
        setEncodedClassPuml(data.encodedPuml);
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        console.error("convert preview error", e);
      }
    }, 500);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [objects, links]);

  // ===== オブジェクト操作 =====
  const handleAddObject = () => {
    const id = makeId();
    const newObj: Obj = { id, name: "", slots: [] };
    setObjects((prev) => [...prev, newObj]);
    setSelectedObjectId(id);
  };

  const handleUpdateObject = (id: string, partial: Partial<Obj>) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...partial } : o))
    );
  };

  const handleDeleteObject = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setLinks((prev) => prev.filter((l) => l.from !== id && l.to !== id));
    if (selectedObjectId === id) setSelectedObjectId(null);
  };

  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );

  // ===== スロット操作 =====
  const handleAddSlotToSelected = () => {
    if (!selectedObject) return;
    const updated: Obj = {
      ...selectedObject,
      slots: [...selectedObject.slots, { key: "", value: "" }],
    };
    handleUpdateObject(selectedObject.id, updated);
  };

  const handleUpdateSlot = (index: number, partial: Partial<Slot>) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.map((s, i) =>
      i === index ? { ...s, ...partial } : s
    );
    handleUpdateObject(selectedObject.id, { slots: newSlots } as Partial<Obj>);
  };

  const handleDeleteSlot = (index: number) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.filter((_, i) => i !== index);
    handleUpdateObject(selectedObject.id, { slots: newSlots } as Partial<Obj>);
  };

  // ===== リンク操作 =====
  const handleAddLink = () => {
    if (objects.length < 2) return;
    const id = makeId();
    const newLink: Link = {
      id,
      from: objects[0]?.id ?? "",
      to: objects[1]?.id ?? "",
      label: "",
    };
    setLinks((prev) => [...prev, newLink]);
    setSelectedLinkId(id);
  };

  const handleUpdateLink = (id: string, partial: Partial<Link>) => {
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...partial } : l))
    );
  };

  const handleDeleteLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    if (selectedLinkId === id) setSelectedLinkId(null);
  };

  const selectedLink = useMemo(
    () => links.find((l) => l.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  );

  // ===== 状態の保存・復元・クリア =====
  const handleSaveState = () => {
    const payload = { objects, links };
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(payload));
    alert("現在のオブジェクト図の状態を保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) {
        alert("保存されている状態がありません。");
        return;
      }
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      setObjects(parsed.objects ?? []);
      setLinks(parsed.links ?? []);
      setSelectedObjectId(null);
      setSelectedLinkId(null);
      alert("保存されていた状態を復元しました。");
    } catch {
      alert("状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleClearAll = () => {
    if (
      !window.confirm("オブジェクトとリンクをすべて削除します。よろしいですか？")
    )
      return;
    setObjects([]);
    setLinks([]);
    setSelectedObjectId(null);
    setSelectedLinkId(null);
    setClassPuml("");
    setEncodedClassPuml("");
    setIssues(null);
    setRelationHints([]);
  };

  // ===== クラス図編集ページへ遷移 =====
  const handleConvertAndOpenClassEditor = async () => {
    let result: ConvertResponse | null = null;

    if (classPuml) {
      result = {
        classPuml,
        encodedPuml: encodedClassPuml,
        issues: issues ?? undefined,
        relationHints,
      };
    } else {
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
              return {
                from: fromObj?.name ?? "",
                to: toObj?.name ?? "",
                label: l.label,
              };
            }),
          }),
        });

        if (!res.ok) {
          console.error("convert API error", await res.text());
          alert("クラス図への変換中にエラーが発生しました。");
          return;
        }

        const data = (await res.json()) as ConvertResponse;
        setClassPuml(data.classPuml);
        setEncodedClassPuml(data.encodedPuml);
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);

        result = data;
      } catch (e) {
        console.error(e);
        alert("クラス図への変換で予期しないエラーが発生しました。");
        return;
      }
    }

    if (!result) return;

    const editorPayload: EditorPayload = {
      initialClassPuml: result.classPuml,
      relationHints: result.relationHints ?? [],
      snapshot: {
        objects,
        links,
      },
    };
    localStorage.setItem(
      STORAGE_KEY_EDITOR_INITIAL,
      JSON.stringify(editorPayload)
    );

    router.push("/experiment/class-editor");
  };

  // ===== オブジェクト図問題文のハイライト（選択オブジェクト名） =====
  const highlightedObjectProblem = useMemo<React.ReactNode>(() => {
    const text = objectProblemText || "";
    const target = selectedObject?.name?.trim();
    if (!target) return text;

    const parts = text.split(target);
    const nodes: React.ReactNode[] = [];

    parts.forEach((part, idx) => {
      if (idx > 0) {
        nodes.push(
          <span
            key={`hl-${idx}`}
            className="bg-amber-100 rounded px-0.5 font-semibold"
          >
            {target}
          </span>
        );
      }
      nodes.push(
        <React.Fragment key={`part-${idx}`}>{part}</React.Fragment>
      );
    });

    return nodes;
  }, [objectProblemText, selectedObject?.name]);

  // ===== PlantUML サーバURL =====
  const objectPreviewUrl = useMemo(() => {
    if (!encodedObjectPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}`;
  }, [encodedObjectPuml]);

  const classPreviewUrl = useMemo(() => {
    if (!encodedClassPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedClassPuml}`;
  }, [encodedClassPuml]);

  // ===== レイアウト =====
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 上部ボタン列 */}
      <div className="flex items-center gap-2 p-2 border-b bg-white">
        <button
          className="px-3 py-1 rounded bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200"
          onClick={handleClearAll}
        >
          すべてクリア
        </button>
        <button
          className="px-3 py-1 rounded bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200"
          onClick={handleSaveState}
        >
          状態を保存
        </button>
        <button
          className="px-3 py-1 rounded bg-sky-100 text-sky-700 text-sm font-semibold hover:bg-sky-200"
          onClick={handleLoadState}
        >
          最後の保存状態を復元
        </button>

        <div className="flex-1" />
        <button
          className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          onClick={handleConvertAndOpenClassEditor}
        >
          クラス図編集画面へ進む
        </button>
      </div>

      {/* メイン 3カラムレイアウト */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：問題文 */}
        <div className="w-1/4 min-w-[260px] border-r bg-white flex flex-col overflow-y-auto">
          <div className="p-2 border-b font-semibold text-sm">要求文</div>

          {/* クラス図作成問題文 */}
          <div className="p-2 border-b text-xs flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold">クラス図作成問題文</span>
              <button
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-slate-100"
                onClick={() => setShowClassProblemFull((v) => !v)}
              >
                {showClassProblemFull ? "本文を折りたたむ" : "本文を表示"}
              </button>
            </div>
            <div
              className={
                "mt-1 whitespace-pre-wrap text-[11px] leading-relaxed border rounded bg-slate-50 px-2 py-1 " +
                (showClassProblemFull ? "" : "max-h-[80px] overflow-hidden")
              }
            >
              {classProblemText}
            </div>
          </div>

          {/* オブジェクト図作成問題文 */}
          <div className="p-2 text-xs flex flex-col gap-1 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold">オブジェクト図作成問題文</span>
              <button
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-slate-100"
                onClick={() => setShowObjectProblemFull((v) => !v)}
              >
                {showObjectProblemFull ? "本文を折りたたむ" : "本文を表示"}
              </button>
            </div>
            <div
              className={
                "mt-1 whitespace-pre-wrap text-[11px] leading-relaxed border rounded bg-slate-50 px-2 py-1 " +
                (showObjectProblemFull ? "" : "max-h-[80px] overflow-hidden")
              }
            >
              {highlightedObjectProblem}
            </div>
          </div>
        </div>

        {/* 中央：オブジェクト編集＋オブジェクト図プレビュー */}
        <div className="w-1/3 border-r flex flex-col">
          {/* オブジェクト編集 */}
          <div className="h-1/2 border-b flex flex-col">
            <div className="p-2 border-b flex items-center justify-between bg-white">
              <span className="font-semibold text-sm">オブジェクト編集</span>
              <button
                className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                onClick={handleAddObject}
              >
                ＋ オブジェクト追加
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* オブジェクト一覧 */}
              <div className="w-2/5 border-r overflow-y-auto text-xs bg-slate-50">
                {objects.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだオブジェクトがありません。「オブジェクト追加」から作成してください。
                  </div>
                )}
                {objects.map((o) => {
                  const isSelected = selectedObjectId === o.id;
                  return (
                    <button
                      key={o.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex items-center justify-between " +
                        (isSelected
                          ? "bg-amber-100 ring-1 ring-amber-400"
                          : "hover:bg-slate-100")
                      }
                      onClick={() =>
                        setSelectedObjectId((prev) => (prev === o.id ? null : o.id))
                      }
                    >
                      <span className="truncate">
                        {o.name || "(無名オブジェクト)"}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-2">
                        {o.slots.length} スロット
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* オブジェクト詳細編集 */}
              <div className="flex-1 overflow-y-auto text-xs p-2">
                {!selectedObject && (
                  <div className="text-[11px] text-slate-500">
                    左の一覧から編集したいオブジェクトを選択してください。
                  </div>
                )}
                {selectedObject && (
                  <div className="flex flex-col gap-2">
                    {/* 名前 */}
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        オブジェクト名
                      </label>
                      <input
                        className="w-full border rounded px-2 py-1 text-xs"
                        value={selectedObject.name}
                        onChange={(e) =>
                          handleUpdateObject(selectedObject.id, {
                            name: e.target.value,
                          })
                        }
                        placeholder="例）学生1、授業A など"
                      />
                    </div>

                    {/* スロット一覧 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold">
                          スロット（スロット名 と 値）
                        </span>
                        <button
                          className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                          onClick={handleAddSlotToSelected}
                        >
                          ＋ スロット追加
                        </button>
                      </div>
                      {selectedObject.slots.length === 0 && (
                        <div className="text-[11px] text-slate-500 mb-1">
                          例）スロット名：年齢、値：19 など
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        {selectedObject.slots.map((s, idx) => (
                          <div
                            key={idx}
                            className="border rounded px-2 py-1 bg-white flex flex-col gap-2"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.key}
                                onChange={(e) =>
                                  handleUpdateSlot(idx, { key: e.target.value })
                                }
                                placeholder="スロット名（例：年齢）"
                              />
                              <span className="text-[11px] text-slate-400">
                                =
                              </span>
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.value}
                                onChange={(e) =>
                                  handleUpdateSlot(idx, {
                                    value: e.target.value,
                                  })
                                }
                                placeholder={'値（例：19、"文学" など）'}
                              />
                            </div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => handleDeleteSlot(idx)}
                              >
                                🗑 スロット削除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 削除 */}
                    <div className="mt-3 pt-2 border-t border-dashed border-red-200 flex justify-end">
                      <button
                        type="button"
                        className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 font-semibold hover:bg-red-200"
                        onClick={() => handleDeleteObject(selectedObject.id)}
                      >
                        🗑 このオブジェクトを削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* オブジェクト図プレビュー */}
          <div className="flex-1 flex flex-col">
            <div className="p-2 border-b bg-white flex items-center justify-between">
              <span className="font-semibold text-sm">
                オブジェクト図プレビュー（リアルタイム）
              </span>
              <span className="text-[11px] text-slate-500">
                上でオブジェクトやリンクを編集すると、ここに反映されます。
              </span>
            </div>
            <div className="flex-1 overflow-auto bg-white">
              {!objectPreviewUrl && (
                <div className="p-3 text-[11px] text-slate-500">
                  オブジェクトやリンクを入力すると、ここにオブジェクト図が表示されます。
                </div>
              )}
              {objectPreviewUrl && (
                <iframe
                  src={objectPreviewUrl}
                  className="w-full h-full"
                  title="オブジェクト図プレビュー"
                />
              )}
            </div>
          </div>
        </div>

        {/* 右：リンク編集＋推定クラス図プレビュー */}
        <div className="flex-1 flex flex-col">
          {/* リンク編集 */}
          <div className="h-1/2 border-b flex flex-col">
            <div className="p-2 border-b flex items-center justify-between bg-white">
              <span className="font-semibold text-sm">リンク編集</span>
              <button
                className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                onClick={handleAddLink}
              >
                ＋ リンク追加
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden text-xs">
              {/* リンク一覧 */}
              <div className="w-1/2 border-r overflow-y-auto bg-slate-50">
                {links.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだリンクがありません。「リンク追加」からオブジェクト間の関係を追加してください。
                  </div>
                )}
                {links.map((l) => {
                  const from = objects.find((o) => o.id === l.from);
                  const to = objects.find((o) => o.id === l.to);
                  const isSelected = selectedLinkId === l.id;
                  return (
                    <button
                      key={l.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex flex-col " +
                        (isSelected
                          ? "bg-rose-100 ring-1 ring-rose-400"
                          : "hover:bg-slate-100")
                      }
                      onClick={() =>
                        setSelectedLinkId((prev) => (prev === l.id ? null : l.id))
                      }
                    >
                      <div className="flex justify-between">
                        <span className="truncate">
                          {from?.name || "(未設定)"} → {to?.name || "(未設定)"}
                        </span>
                      </div>
                      {l.label && (
                        <div className="text-[10px] text-slate-500">
                          {l.label}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* リンク詳細編集 */}
              <div className="flex-1 overflow-y-auto p-2">
                {!selectedLink && (
                  <div className="text-[11px] text-slate-500">
                    左の一覧から編集したいリンクを選択してください。
                  </div>
                )}
                {selectedLink && (
                  <div className="flex flex-col gap-2 text-xs">
                    {/* ◯は △を ～ の形 */}
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        関係を持つオブジェクトとその名前
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={selectedLink.from}
                          onChange={(e) =>
                            handleUpdateLink(selectedLink.id, {
                              from: e.target.value,
                            })
                          }
                        >
                          {objects.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name || "(無名)"}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px]">は</span>
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={selectedLink.to}
                          onChange={(e) =>
                            handleUpdateLink(selectedLink.id, {
                              to: e.target.value,
                            })
                          }
                        >
                          {objects.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name || "(無名)"}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px]">を</span>
                        <span className="text-[11px] text-slate-500">
                          {selectedLink.label || "（〜する）"}
                        </span>
                      </div>
                    </div>

                    {/* ラベル */}
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        関係の説明
                      </label>
                      <input
                        className="w-full border rounded px-2 py-1 text-[11px]"
                        value={selectedLink.label}
                        onChange={(e) =>
                          handleUpdateLink(selectedLink.id, {
                            label: e.target.value,
                          })
                        }
                        placeholder="例）履修する、担当する など"
                      />
                    </div>

                    {/* 削除 */}
                    <div className="mt-3 pt-2 border-t border-dashed border-red-200 flex justify-end">
                      <button
                        className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200 font-semibold"
                        onClick={() => handleDeleteLink(selectedLink.id)}
                      >
                        🗑 このリンクを削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 推定クラス図プレビュー */}
          <div className="flex-1 flex flex-col">
            <div className="p-2 border-b bg-white flex items-center justify-between">
              <span className="font-semibold text-sm">
                推定クラス図プレビュー
              </span>
            </div>
            <div className="flex-1 overflow-auto bg-white flex flex-col">
              {!encodedClassPuml && (
                <div className="p-3 text-[11px] text-slate-500">
                  オブジェクトとリンクを入力すると、ここに推定されたクラス図が表示されます。
                </div>
              )}
              {encodedClassPuml && (
                <div className="flex-1 flex flex-col">
                  {classPreviewUrl && (
                    <div className="flex-1 overflow-auto border-b">
                      <iframe
                        src={classPreviewUrl}
                        className="w-full h-full"
                        title="推定クラス図"
                      />
                    </div>
                  )}
                  {issues && (
                    <div className="p-2 text-[11px] border-t bg-slate-50">
                      <div className="font-semibold mb-1">
                        推定クラス図のチェック結果
                      </div>
                      {issues.classes.length === 0 && (
                        <div className="text-slate-500">
                          特に未完成・矛盾のある属性は見つかりませんでした。
                        </div>
                      )}
                      {issues.classes.map((c) => (
                        <div key={c.name} className="mb-1">
                          <div className="font-semibold">{c.name}</div>
                          {c.incomplete.length > 0 && (
                            <div className="text-amber-700">
                              未入力の可能性がある属性:{" "}
                              {c.incomplete.join(", ")}
                            </div>
                          )}
                          {c.contradictory.length > 0 && (
                            <div className="text-red-700">
                              型が混在している属性:{" "}
                              {c.contradictory.join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExperimentPage;
