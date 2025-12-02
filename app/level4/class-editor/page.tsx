"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../../components/problem-config";

// ===== 型定義 =====
type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};

type EditorInitialPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  snapshot?: unknown;
};

type ClassAttr = {
  id: string;
  name: string;
  type: string;
};

type ClassState = {
  id: string;
  name: string;
  attrs: ClassAttr[];
};

type RelationState = {
  id: string;
  fromClassId: string;
  toClassId: string;
  label: string;
  leftMultiplicity: string;
  rightMultiplicity: string;
  dotted: boolean;
};

const STORAGE_KEY_EDITOR_INITIAL = "LEVEL4_CLASS_EDITOR_INITIAL";
const STORAGE_KEY_EDITOR_SAVED = "LEVEL4_CLASS_EDITOR_SAVED";

const MULTIPLICITY_OPTIONS = ["", "0..1", "1", "0..*", "1..*"];

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// ===== PlantUML → モデル への簡易パーサ =====
function parseInitialModel(
  puml: string | undefined,
  hints: RelationHint[] | undefined
): { classes: ClassState[]; relations: RelationState[] } {
  if (!puml) return { classes: [], relations: [] };

  const lines = puml.split("\n").map((l) => l.trim());

  type ParsedClass = { name: string; attrs: { name: string; type: string }[] };
  type ParsedRelation = {
    fromClass: string;
    toClass: string;
    leftMultiplicity: string;
    rightMultiplicity: string;
    dotted: boolean;
  };

  const parsedClasses: ParsedClass[] = [];
  const parsedRelations: ParsedRelation[] = [];

  let currentClass: ParsedClass | null = null;

  for (const line of lines) {
    if (!line || line.startsWith("@") || line.startsWith("hide ") || line.startsWith("skinparam")) {
      continue;
    }

    // class 行
    if (line.startsWith("class ")) {
      const m = line.match(/^class\s+(.+?)(?:\s+<<[^>]+>>)?\s*\{$/);
      if (m) {
        currentClass = { name: m[1].trim(), attrs: [] };
        parsedClasses.push(currentClass);
      }
      continue;
    }

    // クラス本体中
    if (currentClass) {
      if (line.startsWith("}")) {
        currentClass = null;
        continue;
      }
      const mAttr = line.match(/^(.+?):\s+(\w+)/);
      if (mAttr) {
        currentClass.attrs.push({
          name: mAttr[1].trim(),
          type: mAttr[2].trim(),
        });
      }
      continue;
    }

    // 関連行 例: 学生 "1" -- "0..1" 授業
    const mRel = line.match(
      /^(.+?)\s+"([^"]+)"\s+([.\-]{2})\s+"([^"]+)"\s+(.+?)$/
    );
    if (mRel) {
      const fromClass = mRel[1].trim();
      const leftMul = mRel[2].trim();
      const style = mRel[3];
      const rightMul = mRel[4].trim();
      const toClass = mRel[5].trim();
      parsedRelations.push({
        fromClass,
        toClass,
        leftMultiplicity: leftMul,
        rightMultiplicity: rightMul,
        dotted: style.includes("."),
      });
    }
  }

  // ClassState へ変換
  const classes: ClassState[] = parsedClasses.map((pc) => ({
    id: makeId(),
    name: pc.name,
    attrs: pc.attrs.map((a) => ({
      id: makeId(),
      name: a.name,
      type: a.type || "string",
    })),
  }));

  const nameToId = new Map<string, string>();
  classes.forEach((c) => nameToId.set(c.name, c.id));

  // RelationState へ変換（label はヒントから決める）
  const relations: RelationState[] = parsedRelations.map((pr) => {
    const fromId = nameToId.get(pr.fromClass) ?? "";
    const toId = nameToId.get(pr.toClass) ?? "";

    const hint = hints?.find(
      (h) => h.fromClass === pr.fromClass && h.toClass === pr.toClass
    );
    let label = "";
    if (hint && hint.candidates.length > 0) {
      const best = [...hint.candidates].sort((a, b) => b.count - a.count)[0];
      label = best.label;
    }

    return {
      id: makeId(),
      fromClassId: fromId,
      toClassId: toId,
      label,
      leftMultiplicity: pr.leftMultiplicity || "",
      rightMultiplicity: pr.rightMultiplicity || "",
      dotted: pr.dotted,
    };
  });

  return { classes, relations };
}

// ===== モデル → PlantUML =====
function buildClassDiagramPuml(
  classes: ClassState[],
  relations: RelationState[]
): string {
  let puml = "@startuml\n";
  puml += "hide empty members\n";
  puml += "skinparam classAttributeIconSize 0\n";

  for (const c of classes) {
    puml += `class ${c.name || "(無名クラス)"} {\n`;
    for (const a of c.attrs) {
      if (!a.name) continue;
      const t = a.type || "string";
      puml += `  ${a.name}: ${t}\n`;
    }
    puml += "}\n";
  }

  for (const r of relations) {
    const a = classes.find((c) => c.id === r.fromClassId);
    const b = classes.find((c) => c.id === r.toClassId);
    if (!a || !b) continue;
    const style = r.dotted ? ".." : "--";
    const leftMul = r.leftMultiplicity || "";
    const rightMul = r.rightMultiplicity || "";
    const labelPart = r.label ? ` : ${r.label}` : "";
    puml += `${a.name || "(無名)"} "${leftMul}" ${style} "${rightMul}" ${
      b.name || "(無名)"
    }${labelPart}\n`;
  }

  puml += "@enduml";
  return puml;
}

// ===== メインコンポーネント =====
const ClassEditorPage: React.FC = () => {
  const router = useRouter();
  const { classProblemText } = useProblemConfig();

  const [classes, setClasses] = useState<ClassState[]>([]);
  const [relations, setRelations] = useState<RelationState[]>([]);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);
  const [encodedPreview, setEncodedPreview] = useState<string>("");

  // 初期状態の読み込み（保存済みがあればそれを優先）
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(STORAGE_KEY_EDITOR_SAVED);
      if (savedRaw) {
        const saved = JSON.parse(savedRaw) as {
          classes: ClassState[];
          relations: RelationState[];
        };
        setClasses(saved.classes ?? []);
        setRelations(saved.relations ?? []);
        return;
      }
    } catch {
      // 無視
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;
      const payload = JSON.parse(raw) as EditorInitialPayload;
      const { classes, relations } = parseInitialModel(
        payload.initialClassPuml,
        payload.relationHints
      );
      setClasses(classes);
      setRelations(relations);
      setRelationHints(payload.relationHints ?? []);
    } catch {
      // 無視
    }
  }, []);

  // PlantUML プレビューの更新
  useEffect(() => {
    if (classes.length === 0) {
      setEncodedPreview("");
      return;
    }
    const puml = buildClassDiagramPuml(classes, relations);
    try {
      const encoded = plantumlEncoder.encode(puml);
      setEncodedPreview(encoded);
    } catch {
      setEncodedPreview("");
    }
  }, [classes, relations]);

  const previewUrl = useMemo(() => {
    if (!encodedPreview) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedPreview}`;
  }, [encodedPreview]);

  // ===== シンプルフィードバック =====
  const feedbackMessages = useMemo(() => {
    const msgs: string[] = [];

    if (classes.length === 0) {
      msgs.push("クラスが1つもありません。まずはクラスを追加してみましょう。");
      return msgs;
    }

    const unnamed = classes.filter((c) => !c.name.trim());
    if (unnamed.length > 0) {
      msgs.push("名前が未入力のクラスがあります。クラス名を決めてみましょう。");
    }

    const noAttrs = classes.filter((c) => c.attrs.length === 0);
    if (noAttrs.length > 0) {
      msgs.push(
        "属性が1つもないクラスがあります。必要に応じて属性（年齢、名称など）を追加してみましょう。"
      );
    }

    if (relations.length === 0) {
      msgs.push(
        "関連が1つもありません。クラス同士の関係（例：学生と授業の関係）を追加してみましょう。"
      );
    } else {
      const noLabel = relations.filter((r) => !r.label.trim());
      if (noLabel.length > 0) {
        msgs.push(
          "関連名が未入力の関連があります。矢印の意味がわかるように名前を付けてみましょう（例：履修する）。"
        );
      }

      const noMul = relations.filter(
        (r) => !r.leftMultiplicity && !r.rightMultiplicity
      );
      if (noMul.length > 0) {
        msgs.push(
          "多重度が未設定の関連があります。右下の多重度を使って「1対多」「0..1」などを考えてみましょう。"
        );
      }
    }

    if (msgs.length === 0) {
      msgs.push("大きな問題は見つかりません。図が読みやすいか、最後に見直してみましょう。");
    }

    return msgs;
  }, [classes, relations]);

  // ===== クラス操作 =====
  const handleAddClass = () => {
    setClasses((prev) => [
      ...prev,
      { id: makeId(), name: "", attrs: [] },
    ]);
  };

  const handleUpdateClassName = (id: string, name: string) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c))
    );
  };

  const handleDeleteClass = (id: string) => {
    if (!window.confirm("このクラスと関連する関連も削除します。よろしいですか？")) {
      return;
    }
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) =>
      prev.filter((r) => r.fromClassId !== id && r.toClassId !== id)
    );
  };

  const handleAddAttr = (classId: string) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? {
              ...c,
              attrs: [
                ...c.attrs,
                { id: makeId(), name: "", type: "string" },
              ],
            }
          : c
      )
    );
  };

  const handleUpdateAttr = (
    classId: string,
    attrId: string,
    partial: Partial<ClassAttr>
  ) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? {
              ...c,
              attrs: c.attrs.map((a) =>
                a.id === attrId ? { ...a, ...partial } : a
              ),
            }
          : c
      )
    );
  };

  const handleDeleteAttr = (classId: string, attrId: string) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? { ...c, attrs: c.attrs.filter((a) => a.id !== attrId) }
          : c
      )
    );
  };

  // ===== 関連操作 =====
  const handleAddRelation = () => {
    if (classes.length < 2) {
      alert("関連を追加するには、少なくとも 2 つのクラスが必要です。");
      return;
    }
    const fromId = classes[0].id;
    const toId = classes[1].id;
    setRelations((prev) => [
      ...prev,
      {
        id: makeId(),
        fromClassId: fromId,
        toClassId: toId,
        label: "",
        leftMultiplicity: "1",
        rightMultiplicity: "0..1",
        dotted: false,
      },
    ]);
  };

  const handleUpdateRelation = (
    id: string,
    partial: Partial<RelationState>
  ) => {
    setRelations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...partial } : r))
    );
  };

  const handleDeleteRelation = (id: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== id));
  };

  const getRelationHintCandidates = (r: RelationState) => {
    const from = classes.find((c) => c.id === r.fromClassId);
    const to = classes.find((c) => c.id === r.toClassId);
    if (!from || !to) return [];
    const h = relationHints.find(
      (hh) => hh.fromClass === from.name && hh.toClass === to.name
    );
    if (!h) return [];
    return [...h.candidates].sort((a, b) => b.count - a.count);
  };

  // ===== 状態保存／復元 =====
  const handleSave = () => {
    const payload = { classes, relations };
    localStorage.setItem(STORAGE_KEY_EDITOR_SAVED, JSON.stringify(payload));
    alert("現在のクラス図の状態を保存しました。");
  };

  const handleRestore = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_SAVED);
      if (!raw) {
        alert("保存されているクラス図の状態がありません。");
        return;
      }
      const parsed = JSON.parse(raw) as {
        classes: ClassState[];
        relations: RelationState[];
      };
      setClasses(parsed.classes ?? []);
      setRelations(parsed.relations ?? []);
      alert("保存されていたクラス図の状態を復元しました。");
    } catch {
      alert("クラス図の状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleReset = () => {
    if (!window.confirm("クラス図をすべてリセットします。よろしいですか？")) return;
    setClasses([]);
    setRelations([]);
  };

  // ===== レイアウト =====
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 上部バー */}
      <div className="flex items-center gap-2 p-2 border-b bg-white">
        <button
          className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200"
          onClick={() => router.push("/level4")}
        >
          ← オブジェクト図へ戻る
        </button>

        <div className="flex-1" />

        <button
          className="px-3 py-1 rounded bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200"
          onClick={handleReset}
        >
          すべてリセット
        </button>
        <button
          className="px-3 py-1 rounded bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200"
          onClick={handleSave}
        >
          状態を保存
        </button>
        <button
          className="px-3 py-1 rounded bg-sky-100 text-sky-700 text-sm font-semibold hover:bg-sky-200"
          onClick={handleRestore}
        >
          保存状態を復元
        </button>
      </div>

      {/* メイン：左右 6 : 4 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左 6：上＝問題文 / 下＝クラス編集＋関連編集 */}
        <div className="w-3/5 border-r flex flex-col overflow-hidden">
          {/* 左上：クラス図作成問題文 */}
          <div className="p-3 border-b bg-white h-1/3 min-h-[140px]">
            <div className="text-xs font-semibold mb-1">
              クラス図作成問題（本文）
            </div>
            <div className="mt-1 h-full overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed border rounded bg-slate-50 px-2 py-1">
              {classProblemText}
            </div>
          </div>

          {/* 左下：クラス編集（左）＋関連編集（右） */}
          <div className="flex flex-1 border-t bg-slate-50 overflow-hidden">
            {/* クラス編集（左下左） */}
            <div className="w-1/2 border-r flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
                <span className="font-semibold text-sm">クラスの編集</span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddClass}
                >
                  ＋ クラスを追加
                </button>
              </div>
              <div className="flex-1 overflow-auto px-3 pb-3 pt-2">
                <div className="text-[11px] text-slate-600 mb-2">
                  クラス名と属性名・型を編集すると、右上のクラス図に自動で反映されます。
                </div>
                {classes.length === 0 && (
                  <div className="text-[11px] text-slate-500">
                    まずは「クラスを追加」からクラスを作成してみましょう。
                  </div>
                )}
                <div className="flex flex-col gap-3 mt-1">
                  {classes.map((c) => (
                    <div
                      key={c.id}
                      className="border rounded bg-slate-50 p-2 flex flex-col gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] font-semibold">
                          クラス名
                        </label>
                        <input
                          className="flex-1 border rounded px-2 py-1 text-xs"
                          value={c.name}
                          onChange={(e) =>
                            handleUpdateClassName(c.id, e.target.value)
                          }
                          placeholder="例）学生、授業 など"
                        />
                        <button
                          className="px-2 py-0.5 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200"
                          onClick={() => handleDeleteClass(c.id)}
                        >
                          🗑
                        </button>
                      </div>

                      {/* 属性一覧 */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold">
                            属性一覧
                          </span>
                          <button
                            className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                            onClick={() => handleAddAttr(c.id)}
                          >
                            ＋ 属性を追加
                          </button>
                        </div>
                        {c.attrs.length === 0 && (
                          <div className="text-[11px] text-slate-500 mb-1">
                            例）属性名：年齢、型：string
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          {c.attrs.map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center gap-2 bg-white border rounded px-2 py-1"
                            >
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={a.name}
                                onChange={(e) =>
                                  handleUpdateAttr(c.id, a.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="属性名（例：年齢）"
                              />
                              <span className="text-[11px] text-slate-400">
                                :
                              </span>
                              <select
                                className="border rounded px-1 py-0.5 text-[11px]"
                                value={a.type}
                                onChange={(e) =>
                                  handleUpdateAttr(c.id, a.id, {
                                    type: e.target.value,
                                  })
                                }
                              >
                                <option value="string">string</option>
                                <option value="int">int</option>
                                <option value="real">real</option>
                                <option value="boolean">boolean</option>
                              </select>
                              <button
                                className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => handleDeleteAttr(c.id, a.id)}
                              >
                                🗑
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 関連編集（左下右） */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
                <span className="font-semibold text-sm">関連と多重度の編集</span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddRelation}
                >
                  ＋ 関連を追加
                </button>
              </div>
              <div className="flex-1 overflow-auto px-3 pb-3 pt-2">
                <div className="text-[11px] text-slate-600 mb-2">
                  どのクラス同士が関係しているか、多重度がどうなっているかを確認・修正します。
                </div>
                {relations.length === 0 && (
                  <div className="text-[11px] text-slate-500">
                    まだ関連がありません。「関連を追加」からクラス間の関係を追加してください。
                  </div>
                )}
                <div className="flex flex-col gap-2 mt-1">
                  {relations.map((r) => {
                    const hintCandidates = getRelationHintCandidates(r);
                    return (
                      <div
                        key={r.id}
                        className="border rounded bg-slate-50 p-2 flex flex-col gap-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="border rounded px-1 py-0.5 text-[11px]"
                            value={r.fromClassId}
                            onChange={(e) =>
                              handleUpdateRelation(r.id, {
                                fromClassId: e.target.value,
                              })
                            }
                          >
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name || "(無名)"}
                              </option>
                            ))}
                          </select>
                          <span className="text-[11px]">の</span>
                          <select
                            className="border rounded px-1 py-0.5 text-[11px]"
                            value={r.leftMultiplicity}
                            onChange={(e) =>
                              handleUpdateRelation(r.id, {
                                leftMultiplicity: e.target.value,
                              })
                            }
                          >
                            {MULTIPLICITY_OPTIONS.map((m) => (
                              <option key={m} value={m}>
                                {m || " "}
                              </option>
                            ))}
                          </select>
                          <span className="text-[11px]">→</span>
                          <select
                            className="border rounded px-1 py-0.5 text-[11px]"
                            value={r.toClassId}
                            onChange={(e) =>
                              handleUpdateRelation(r.id, {
                                toClassId: e.target.value,
                              })
                            }
                          >
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name || "(無名)"}
                              </option>
                            ))}
                          </select>
                          <select
                            className="border rounded px-1 py-0.5 text-[11px]"
                            value={r.rightMultiplicity}
                            onChange={(e) =>
                              handleUpdateRelation(r.id, {
                                rightMultiplicity: e.target.value,
                              })
                            }
                          >
                            {MULTIPLICITY_OPTIONS.map((m) => (
                              <option key={m} value={m}>
                                {m || " "}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px]">関連名</span>
                          <input
                            className="flex-1 border rounded px-2 py-1 text-[11px]"
                            value={r.label}
                            onChange={(e) =>
                              handleUpdateRelation(r.id, {
                                label: e.target.value,
                              })
                            }
                            placeholder="例）履修する、担当する など"
                          />
                          <label className="flex items-center gap-1 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              className="accent-slate-600"
                              checked={r.dotted}
                              onChange={(e) =>
                                handleUpdateRelation(r.id, {
                                  dotted: e.target.checked,
                                })
                              }
                            />
                            不確かな関連（点線）
                          </label>
                          <button
                            className="px-2 py-0.5 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200"
                            onClick={() => handleDeleteRelation(r.id)}
                          >
                            🗑
                          </button>
                        </div>

                        {hintCandidates.length > 0 && (
                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-1">
                            <span>候補:</span>
                            {hintCandidates.map((h) => (
                              <button
                                key={h.label}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200"
                                type="button"
                                onClick={() =>
                                  handleUpdateRelation(r.id, { label: h.label })
                                }
                              >
                                {h.label}
                                <span className="text-[10px] text-slate-500 ml-1">
                                  ({h.count})
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右 4：上＝クラス図プレビュー / 下＝フィードバック */}
        <div className="w-2/5 flex flex-col overflow-hidden">
          {/* 右上：クラス図プレビュー */}
          <div className="h-1/2 border-b bg-white flex flex-col">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <span className="font-semibold text-sm">
                あなたのクラス図（プレビュー）
              </span>
            </div>
            <div className="flex-1 overflow-auto">
              {!previewUrl && (
                <div className="p-3 text-[11px] text-slate-500">
                  左側でクラスと関連を編集すると、ここにクラス図が表示されます。
                </div>
              )}
              {previewUrl && (
                <iframe
                  src={previewUrl}
                  className="w-full h-full"
                  title="クラス図プレビュー"
                />
              )}
            </div>
          </div>

          {/* 右下：フィードバック */}
          <div className="flex-1 bg-white flex flex-col">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <span className="font-semibold text-sm">フィードバック</span>
            </div>
            <div className="flex-1 overflow-auto p-3 text-[11px]">
              <div className="text-slate-600 mb-2">
                今のクラス図の状態から、学習のヒントになりそうなポイントをまとめています。
              </div>
              <ul className="list-disc pl-4 space-y-1">
                {feedbackMessages.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClassEditorPage;
