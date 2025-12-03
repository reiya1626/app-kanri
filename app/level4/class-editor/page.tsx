// app/level4/class-editor/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../../components/problem-config";

// ===== 型定義 =====
type ClassAttr = {
  id: string;
  name: string;
  type: string;
};

type ClassInfo = {
  id: string;
  name: string;
  attrs: ClassAttr[];
};

type Relation = {
  id: string;
  fromClassId: string;
  toClassId: string;
  label: string;
  leftMultiplicity: string;
  rightMultiplicity: string;
};

type EditorInitialPayload = {
  initialClassPuml?: string;
};

// ===== 定数 =====
const STORAGE_KEY_EDITOR_STATE = "LEVEL4_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "LEVEL4_CLASS_EDITOR_INITIAL";

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// 文字列エスケープ
const esc = (s: string) => s.replace(/"/g, '\\"');

// ===== PlantUML からの簡易パーサ =====
function parseInitialPuml(puml: string | undefined): {
  classes: ClassInfo[];
  relations: Relation[];
} {
  if (!puml) return { classes: [], relations: [] };

  const classes: ClassInfo[] = [];
  const relations: Relation[] = [];

  const lines = puml.split(/\r?\n/);
  let currentClass: ClassInfo | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // class 行
    if (line.startsWith("class ")) {
      // 例: class 学生 <<incomplete>> {
      const m = line.match(/^class\s+(.+?)(?:\s+<<.*?>>)?\s*\{/);
      if (m) {
        const name = m[1].trim();
        const cls: ClassInfo = { id: makeId(), name, attrs: [] };
        classes.push(cls);
        currentClass = cls;
        continue;
      }
    }

    // クラスブロックの終了
    if (line === "}") {
      currentClass = null;
      continue;
    }

    // クラス内属性行
    if (currentClass) {
      // 例: 年齢: string <!>
      const mAttr = line.match(/^(.+?):\s*([a-zA-Z]+)\b/);
      if (mAttr) {
        currentClass.attrs.push({
          id: makeId(),
          name: mAttr[1].trim(),
          type: mAttr[2].trim(),
        });
      }
      continue;
    }

    // 関連行
    // 例: 学生 "1" -- "0..*" 授業 : 履修する
    const mRel = raw.match(
      /^(.+?)\s+"([^"]*)"\s+(\.\.|--)\s+"([^"]*)"\s+(.+?)(?:\s*:\s*(.+))?$/
    );
    if (mRel) {
      const fromName = mRel[1].trim();
      const leftMult = mRel[2].trim();
      const rightMult = mRel[4].trim();
      const toName = mRel[5].trim();
      const label = (mRel[6] || "").trim();

      // 一旦クラス名をそのまま ID として入れておき、後で解決
      relations.push({
        id: makeId(),
        fromClassId: fromName,
        toClassId: toName,
        label,
        leftMultiplicity: leftMult,
        rightMultiplicity: rightMult,
      });
    }
  }

  // クラス名を ID に解決
  for (const r of relations) {
    const fromByName = classes.find((c) => c.name === r.fromClassId);
    if (fromByName) r.fromClassId = fromByName.id;

    const toByName = classes.find((c) => c.name === r.toClassId);
    if (toByName) r.toClassId = toByName.id;
  }

  return { classes, relations };
}

// ===== フィードバック生成（簡易） =====
function makeFeedback(classes: ClassInfo[], relations: Relation[]): string[] {
  const msgs: string[] = [];

  if (classes.some((c) => c.attrs.length === 0)) {
    msgs.push(
      "属性が 1 つもないクラスがあります。必要に応じて属性（年齢、名前 など）を追加してみましょう。"
    );
  }

  // 関連を持たないクラス
  const relatedIds = new Set<string>();
  for (const r of relations) {
    relatedIds.add(r.fromClassId);
    relatedIds.add(r.toClassId);
  }
  const isolated = classes.filter((c) => !relatedIds.has(c.id));
  if (isolated.length > 0) {
    msgs.push(
      "他のクラスとまったく関連がないクラスがあります。必要であれば関連を追加してみましょう。"
    );
  }

  // 無名の関連
  if (relations.some((r) => !r.label.trim())) {
    msgs.push(
      "関連名が空の矢印があります。矢印の意味が分かるように「履修する」「担当する」などの名前を付けてみましょう。"
    );
  }

  if (msgs.length === 0) {
    msgs.push(
      "今のクラス図には特に大きな問題は見つかりませんでした。よりよい名前や属性がないか見直してみましょう。"
    );
  }

  return msgs;
}

// ===== メインコンポーネント =====
const ClassEditorPage: React.FC = () => {
  const router = useRouter();
  const { classProblemText } = useProblemConfig();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [encodedPuml, setEncodedPuml] = useState<string>("");

  // ===== 初期読み込み =====
  useEffect(() => {
    // 1. 保存されている編集状態があれば優先
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as {
          classes: ClassInfo[];
          relations: Relation[];
        };
        if (parsed.classes) setClasses(parsed.classes);
        if (parsed.relations) setRelations(parsed.relations);
        return;
      }
    } catch {
      // 無視
    }

    // 2. それがなければ、オブジェクト図ページから渡された初期 PUML を使う
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;
      const payload = JSON.parse(raw) as EditorInitialPayload;
      const { classes: initClasses, relations: initRelations } =
        parseInitialPuml(payload.initialClassPuml);
      setClasses(initClasses);
      setRelations(initRelations);
      if (initClasses.length > 0) {
        setSelectedClassId(initClasses[0].id);
      }
    } catch {
      // 無視
    }
  }, []);

  // ===== PlantUML の再生成（クラス＋関連＋多重度すべて） =====
  useEffect(() => {
    if (classes.length === 0) {
      setEncodedPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");
    lines.push("hide empty members");
    lines.push("skinparam classAttributeIconSize 0");

    // クラス定義
    for (const cls of classes) {
      lines.push(`class ${esc(cls.name)} {`);
      for (const a of cls.attrs) {
        const ty = a.type || "string";
        lines.push(`  ${esc(a.name)}: ${ty}`);
      }
      lines.push("}");
    }

    // 関連定義
    for (const r of relations) {
      const from = classes.find((c) => c.id === r.fromClassId);
      const to = classes.find((c) => c.id === r.toClassId);
      if (!from || !to) continue;

      const style = "--"; // 常に実線
      const leftMult = r.leftMultiplicity || "";
      const rightMult = r.rightMultiplicity || "";
      const labelPart = r.label ? ` : ${esc(r.label)}` : "";

      lines.push(
        `${esc(from.name)} "${leftMult}" ${style} "${rightMult}" ${esc(
          to.name
        )}${labelPart}`
      );
    }

    lines.push("@enduml");

    try {
      const encoded = plantumlEncoder.encode(lines.join("\n"));
      setEncodedPuml(encoded);
    } catch (e) {
      console.error("encode error", e);
      setEncodedPuml("");
    }
  }, [classes, relations]);

  const previewUrl = useMemo(
    () =>
      encodedPuml
        ? `https://www.plantuml.com/plantuml/svg/${encodedPuml}`
        : "",
    [encodedPuml]
  );

  const feedbackMessages = useMemo(
    () => makeFeedback(classes, relations),
    [classes, relations]
  );

  // ===== ハンドラ：クラス =====
  const handleAddClass = () => {
    const id = makeId();
    const newClass: ClassInfo = {
      id,
      name: "クラス名未定",
      attrs: [],
    };
    setClasses((prev) => [...prev, newClass]);
    setSelectedClassId(id);
  };

  const handleUpdateClass = (id: string, partial: Partial<ClassInfo>) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...partial } : c))
    );
  };

  const handleDeleteClass = (id: string) => {
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) =>
      prev.filter((r) => r.fromClassId !== id && r.toClassId !== id)
    );
    if (selectedClassId === id) setSelectedClassId(null);
  };

  const handleAddAttr = (classId: string) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? {
              ...c,
              attrs: [
                ...c.attrs,
                { id: makeId(), name: "", type: "string" as const },
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

  // ===== ハンドラ：関連 =====
  const handleAddRelation = () => {
    if (classes.length < 2) return;
    const newRel: Relation = {
      id: makeId(),
      fromClassId: classes[0].id,
      toClassId: classes[1].id,
      label: "",
      leftMultiplicity: "1",
      rightMultiplicity: "0..1",
    };
    setRelations((prev) => [...prev, newRel]);
  };

  const handleUpdateRelation = (id: string, partial: Partial<Relation>) => {
    setRelations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...partial } : r))
    );
  };

  const handleDeleteRelation = (id: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== id));
  };

  // ===== 状態の保存・復元・リセット =====
  const handleSaveState = () => {
    const payload = { classes, relations };
    localStorage.setItem(STORAGE_KEY_EDITOR_STATE, JSON.stringify(payload));
    alert("現在のクラス図の状態を保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!raw) {
        alert("保存されている状態がありません。");
        return;
      }
      const parsed = JSON.parse(raw) as {
        classes?: ClassInfo[];
        relations?: Relation[];
      };
      setClasses(parsed.classes ?? []);
      setRelations(parsed.relations ?? []);
      setSelectedClassId(parsed.classes?.[0]?.id ?? null);
      alert("保存されていた状態を復元しました。");
    } catch {
      alert("状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleResetAll = () => {
    if (
      !window.confirm(
        "クラス図編集の状態をすべてリセットします。よろしいですか？"
      )
    ) {
      return;
    }
    localStorage.removeItem(STORAGE_KEY_EDITOR_STATE);
    // 初期 PUML から再読み込み
    const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
    if (!raw) {
      setClasses([]);
      setRelations([]);
      setSelectedClassId(null);
      return;
    }
    const payload = JSON.parse(raw) as EditorInitialPayload;
    const { classes: initClasses, relations: initRelations } = parseInitialPuml(
      payload.initialClassPuml
    );
    setClasses(initClasses);
    setRelations(initRelations);
    setSelectedClassId(initClasses[0]?.id ?? null);
  };

  // 選択中クラス
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;

  // 多重度候補
  const multiplicityOptions = ["1", "0..1", "0..*", "1..*"];

  // ===== レイアウト =====
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* ヘッダ */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white">
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-slate-100 text-sm hover:bg-slate-200"
            onClick={() => router.push("/level4")}
          >
            ← オブジェクト図へ戻る
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-rose-100 text-rose-700 text-sm font-semibold hover:bg-rose-200"
            onClick={handleResetAll}
          >
            すべてリセット
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
            保存状態を復元
          </button>
        </div>
      </div>

      {/* メイン：左 6 / 右 4 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左側 6 : 問題文 + 編集 */}
        <div className="w-3/5 flex flex-col border-r overflow-hidden min-h-0">
          {/* 左上：クラス図作成問題文 */}
          <div className="h-2/5 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">
              クラス図作成問題（本文）
            </div>
            <div className="flex-1 p-3 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap">
              {classProblemText}
            </div>
          </div>

          {/* 左下：クラス編集＋関連編集 */}
          <div className="flex-1 grid grid-cols-2 bg-slate-50 min-h-0">
            {/* クラスの編集 */}
            <div className="border-r flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">クラスの編集</span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddClass}
                >
                  ＋ クラスを追加
                </button>
              </div>

              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* クラス一覧 */}
                <div className="w-2/5 border-r overflow-y-auto bg-slate-50 text-xs">
                  {classes.length === 0 && (
                    <div className="p-2 text-[11px] text-slate-500">
                      まだクラスがありません。「クラスを追加」から作成してください。
                    </div>
                  )}
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex items-center justify-between hover:bg-slate-100 " +
                        (selectedClassId === c.id ? "bg-sky-100" : "")
                      }
                      onClick={() =>
                        setSelectedClassId(
                          selectedClassId === c.id ? null : c.id
                        )
                      }
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-[10px] text-slate-500 ml-1">
                        {c.attrs.length} 属性
                      </span>
                    </button>
                  ))}
                </div>

                {/* クラス詳細 */}
                <div className="flex-1 overflow-y-auto p-2 text-xs bg-white">
                  {!selectedClass && (
                    <div className="text-[11px] text-slate-500">
                      左の一覧から編集したいクラスを選択してください。
                    </div>
                  )}
                  {selectedClass && (
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          クラス名
                        </label>
                        <input
                          className="w-full border rounded px-2 py-1 text-[12px]"
                          value={selectedClass.name}
                          onChange={(e) =>
                            handleUpdateClass(selectedClass.id, {
                              name: e.target.value,
                            })
                          }
                          placeholder="例）学生、授業 など"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold">
                            属性一覧
                          </span>
                          <button
                            className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                            onClick={() => handleAddAttr(selectedClass.id)}
                          >
                            ＋ 属性を追加
                          </button>
                        </div>
                        {selectedClass.attrs.length === 0 && (
                          <div className="text-[11px] text-slate-500 mb-1">
                            例）属性名：年齢、型：string など
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          {selectedClass.attrs.map((a) => (
                            <div
                              key={a.id}
                              className="border rounded px-2 py-1 bg-slate-50 flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                  value={a.name}
                                  onChange={(e) =>
                                    handleUpdateAttr(selectedClass.id, a.id, {
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
                                    handleUpdateAttr(selectedClass.id, a.id, {
                                      type: e.target.value,
                                    })
                                  }
                                >
                                  <option value="string">string</option>
                                  <option value="int">int</option>
                                  <option value="real">real</option>
                                  <option value="boolean">boolean</option>
                                </select>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() =>
                                    handleDeleteAttr(selectedClass.id, a.id)
                                  }
                                >
                                  🗑 属性を削除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-dashed border-red-200 flex justify-end">
                        <button
                          className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 font-semibold hover:bg-red-200"
                          onClick={() => handleDeleteClass(selectedClass.id)}
                        >
                          🗑 このクラスを削除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 関連と多重度の編集 */}
            <div className="flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">
                  関連と多重度の編集
                </span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddRelation}
                >
                  ＋ 関連を追加
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-slate-50 text-xs">
                {relations.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだ関連がありません。どのクラス同士が関係しているか、矢印と多重度を追加してみましょう。
                  </div>
                )}
                {relations.map((r) => (
                  <div
                    key={r.id}
                    className="m-2 p-2 border rounded bg-white flex flex-col gap-1"
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
                            {c.name}
                          </option>
                        ))}
                      </select>

                      <select
                        className="border rounded px-1 py-0.5 text-[11px]"
                        value={r.leftMultiplicity}
                        onChange={(e) =>
                          handleUpdateRelation(r.id, {
                            leftMultiplicity: e.target.value,
                          })
                        }
                      >
                        {multiplicityOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>

                      <span className="text-[11px]">→</span>

                      <select
                        className="border rounded px-1 py-0.5 text-[11px]"
                        value={r.rightMultiplicity}
                        onChange={(e) =>
                          handleUpdateRelation(r.id, {
                            rightMultiplicity: e.target.value,
                          })
                        }
                      >
                        {multiplicityOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>

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
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px]">関連名:</span>
                      <input
                        className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                        value={r.label}
                        onChange={(e) =>
                          handleUpdateRelation(r.id, { label: e.target.value })
                        }
                        placeholder="例）履修する、担当する など"
                      />
                    </div>

                    <div className="flex items-center justify-between mt-1">
                      <div />
                      <button
                        className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteRelation(r.id)}
                      >
                        🗑 この関連を削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右側 4 : プレビュー＋フィードバック */}
        <div className="w-2/5 flex flex-col overflow-hidden min-h-0">
          {/* 右上：クラス図プレビュー */}
          <div className="h-1/2 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">
              あなたのクラス図（プレビュー）
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
                  title="あなたのクラス図プレビュー"
                />
              )}
            </div>
          </div>

          {/* 右下：フィードバック */}
          <div className="flex-1 bg-slate-50 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b bg-white font-semibold text-sm">
              フィードバック
            </div>
            <div className="flex-1 p-3 overflow-auto text-[11px] leading-relaxed">
              <p className="mb-1 text-slate-600">
                今のクラス図の状態から、学習のヒントになりそうなポイントをまとめています。
              </p>
              <ul className="list-disc pl-5 space-y-1">
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
