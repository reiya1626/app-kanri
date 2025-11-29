"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProblemConfig } from "@/components/problem-config";
import { generatePlantUMLUrl } from "@/utils/plantuml";
import type { Obj, Link } from "@/types";

/* ========= 定数 ========= */

const SNAPSHOT_KEY = "LEVEL4_CLASS_EDITOR_SNAPSHOT";

/* ========= 型 ========= */

type EditorPayload = {
  initialClassPuml?: string;
  snapshot?: {
    objects: Obj[];
    links: Link[];
  };
};

type ScoreBreakdown = {
  total: number;
  classes: number;
  relations: number;
  comments: string[];
};

type AttrStatus = "none" | "incomplete" | "contradictory";

type ClassInfo = {
  id: string; // 内部ID（初期クラス名から作る）
  name: string;
  isAutoNamed: boolean; // 「クラス名未定*」かどうか
  attrs: {
    id: string;
    name: string;
    type: string;
    status: AttrStatus;
  }[];
};

type RelationInfo = {
  id: string;
  fromId: string; // ClassInfo.id
  toId: string;
  label: string;
  multFrom: string; // "", "1", "0..1", "0..*", "1..*"
  multTo: string;
  style: "solid" | "dotted";
};



/* ========= ユーティリティ ========= */

const makeId = () => Math.random().toString(36).slice(2, 10);

/** PlantUML からクラスと関連のモデルをざっくり抽出 */
function parsePumlToModel(
  puml: string
): { classes: ClassInfo[]; relations: RelationInfo[] } {
  const lines = puml.split(/\r?\n/);

  const classes: ClassInfo[] = [];
  const relations: RelationInfo[] = [];

  let currentClass: ClassInfo | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // class 行
    const classMatch = line.match(
      /^\s*class\s+([^\s{]+)(?:\s+<<([^>]+)>>)?\s*{/
    );
    if (classMatch) {
      const name = classMatch[1].trim();
      const isAutoNamed = name.startsWith("クラス名未定");
      currentClass = {
        id: name, // 初期は名前をIDにする
        name,
        isAutoNamed,
        attrs: [],
      };
      classes.push(currentClass);
      continue;
    }

    if (currentClass) {
      // クラス定義の終わり
      if (/^\s*}\s*$/.test(line)) {
        currentClass = null;
        continue;
      }
      // 属性行:  key: type <!> / <?>
      const attrMatch = line.match(
        /^\s*([^:]+):\s*([^\s]+)\s*(<!>|<\?>)?\s*$/
      );
      if (attrMatch) {
        const name = attrMatch[1].trim();
        const type = attrMatch[2].trim();
        const mark = attrMatch[3]?.trim();
        let status: AttrStatus = "none";
        if (mark === "<!>") status = "contradictory";
        else if (mark === "<?>") status = "incomplete";
        currentClass.attrs.push({
          id: makeId(),
          name,
          type,
          status,
        });
      }
      continue;
    }

    // 関連行:  A "1" -- "0..1" B : label   or   A "1" .. "0..1" B : label
    const relMatch = line.match(
      /^\s*([^\s"]+)\s+"([^"]*)"\s*(--|\.\.)\s+"([^"]*)"\s+([^\s":]+)(?:\s*:\s*(.+))?$/
    );
    if (relMatch) {
      const fromName = relMatch[1].trim();
      const multFrom = relMatch[2].trim();
      const style = relMatch[3] === ".." ? "dotted" : "solid";
      const multTo = relMatch[4].trim();
      const toName = relMatch[5].trim();
      const label = (relMatch[6] ?? "").trim();

      relations.push({
        id: makeId(),
        fromId: fromName, // ひとまずクラス名＝ID としておく
        toId: toName,
        label,
        multFrom,
        multTo,
        style,
      });
    }
  }

  // 名前→id のマッピング（今は id = 初期名だが、将来拡張用）
  const idMap = new Map<string, string>();
  for (const c of classes) idMap.set(c.id, c.id);

  // 関連の from/to を、存在しない名前だった場合は最初のクラスに寄せる
  const fallbackId = classes[0]?.id ?? "";
  for (const r of relations) {
    if (!idMap.has(r.fromId)) r.fromId = fallbackId;
    if (!idMap.has(r.toId)) r.toId = fallbackId;
  }

  return { classes, relations };
}

/** クラスモデル＋関連モデルから PlantUML を生成 */
function buildPuml(classes: ClassInfo[], relations: RelationInfo[]): string {
  let puml = "@startuml\n";
  puml += "hide empty members\n";
  puml += "skinparam classAttributeIconSize 0\n";
  puml += "skinparam class {\n";
  puml += "  BackgroundColor<<incomplete>> #fffbe6\n";
  puml += "  BackgroundColor<<contradictory>> #ffecec\n";
  puml += "  BorderColor<<contradictory>> #ff6666\n";
  puml += "}\n";

  const esc = (s: string) => s.replace(/"/g, '\\"');

  // クラス定義
  for (const c of classes) {
    const hasContradiction = c.attrs.some(
      (a) => a.status === "contradictory"
    );
    const hasIncomplete = c.attrs.some((a) => a.status === "incomplete");
    const stereo = hasContradiction
      ? " <<contradictory>>"
      : hasIncomplete
      ? " <<incomplete>>"
      : "";

    puml += `class ${esc(c.name)}${stereo} {\n`;
    for (const a of c.attrs) {
      const mark =
        a.status === "contradictory"
          ? " <!>"
          : a.status === "incomplete"
          ? " <?>"
          : "";
      puml += `  ${esc(a.name)}: ${a.type} ${mark}\n`;
    }
    puml += "}\n";
  }

  const normMult = (m: string) => m || "";

  // 関連
  for (const r of relations) {
    const from = classes.find((c) => c.id === r.fromId);
    const to = classes.find((c) => c.id === r.toId);
    if (!from || !to) continue;

    const style = r.style === "dotted" ? ".." : "--";
    const labelPart =
      r.label && r.label.trim().length > 0
        ? ` : ${esc(r.label.trim())}`
        : "";

    puml += `${esc(from.name)} "${normMult(r.multFrom)}" ${style} "${normMult(
      r.multTo
    )}" ${esc(to.name)}${labelPart}\n`;
  }

  puml += "@enduml";
  return puml;
}

/* ==== チェック・採点用 ==== */

function parseClassNames(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const names: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*class\s+([^\s{]+)/);
    if (m) names.push(m[1].trim());
  }
  return Array.from(new Set(names));
}

function parseRelationsForScore(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const rels: string[] = [];
  for (const line of lines) {
    if (!line.includes("--") && !line.includes("..")) continue;
    if (line.trim().startsWith("@")) continue;
    const m = line.match(
      /^\s*([^\s"]+)\s+["0-9.* ]*..?["0-9.* ]*\s+([^\s"]+)/
    );
    if (!m) continue;
    const a = m[1].trim();
    const b = m[2].trim();
    if (!a || !b) continue;
    const key = a < b ? `${a}--${b}` : `${b}--${a}`;
    rels.push(key);
  }
  return Array.from(new Set(rels));
}

function checkClassDiagram(puml: string): string[] {
  const messages: string[] = [];
  if (!puml.trim()) {
    messages.push("クラス図が空です。少なくとも1つはクラスを定義してみましょう。");
    return messages;
  }

  const classes = parseClassNames(puml);
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const c of classes) {
    if (seen.has(c)) dups.push(c);
    else seen.add(c);
  }
  if (dups.length > 0) {
    messages.push(`クラス名が重複しています: ${dups.join(", ")}`);
  }

  const lines = puml.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("--") && !line.includes("..")) continue;
    if (line.trim().startsWith("@")) continue;

    const m = line.match(
      /^\s*([^\s"]+)\s+([^-\n"]*)..?([^"\n]*)\s+([^\s"]+)/
    );
    if (m) {
      const left = m[1].trim();
      const right = m[4].trim();
      if (left && right && left === right) {
        messages.push(
          `クラス「${left}」が自分自身と関連づけられています（自己関連）。意図したものでなければ修正しましょう。`
        );
      }
      const hasMultiplicity = /"/.test(line);
      if (!hasMultiplicity) {
        messages.push(
          `関連「${left} -- ${right}」に多重度が指定されていません（"1", "0..*" など）。`
        );
      }
    }
  }

  if (messages.length === 0) {
    messages.push(
      "大きな形式的な問題は見つかりませんでした（内容の妥当性は別途確認してください）。"
    );
  }

  return messages;
}

/* ================= メインコンポーネント ================= */

export default function Level4ClassEditorPage() {
  const router = useRouter();
  const { classAnswerPuml, classProblemText } = useProblemConfig();

  const [initialClassPuml, setInitialClassPuml] = useState("");
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<RelationInfo[]>([]);
  const [classPuml, setClassPuml] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");

  const [checkMessages, setCheckMessages] = useState<string[]>([]);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [gradeErr, setGradeErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  // 初期データ読み込み（スナップショットがあれば優先）
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      // ① スナップショット優先
      const snapRaw = localStorage.getItem(SNAPSHOT_KEY);
      if (snapRaw) {
        const snap = JSON.parse(snapRaw);
        if (snap.classes && snap.relations) {
          setClasses(snap.classes as ClassInfo[]);
          setRelations(snap.relations as RelationInfo[]);

          const rawInitial = localStorage.getItem(
            "LEVEL4_CLASS_EDITOR_INITIAL"
          );
          if (rawInitial) {
            const payload: EditorPayload = JSON.parse(rawInitial);
            setInitialClassPuml(payload.initialClassPuml ?? "");
          }
          return;
        }
      }

      // ② なければ初回推定から
      const raw = localStorage.getItem("LEVEL4_CLASS_EDITOR_INITIAL");
      if (!raw) {
        setLoadErr(
          "レベル4のページから推定クラス図が渡されていません。「オブジェクト図からクラス図」ページから入り直してください。"
        );
        return;
      }
      const payload: EditorPayload = JSON.parse(raw);
      const base = payload.initialClassPuml ?? "";
      setInitialClassPuml(base);

      const { classes, relations } = parsePumlToModel(base);
      setClasses(classes);
      setRelations(relations);
    } catch (e) {
      setLoadErr("保存された推定クラス図の読み込みに失敗しました。");
    }
  }, []);

  // モデルから PlantUML を再生成 → プレビュー更新
  useEffect(() => {
    if (classes.length === 0) {
      setClassPuml("");
      setCurrentUrl("");
      return;
    }
    const puml = buildPuml(classes, relations);
    setClassPuml(puml);
    setCurrentUrl(generatePlantUMLUrl(puml));
  }, [classes, relations]);

  const unnamedClassIds = useMemo(
    () => classes.filter((c) => c.name.startsWith("クラス名未定")).map((c) => c.id),
    [classes]
  );

  /* ===== 保存 / 復元 ===== */

  const handleSaveSnapshot = () => {
    try {
      const snapshot = {
        classes,
        relations,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      setSnapshotMessage("現在のクラス図の状態を保存しました。");
    } catch (e) {
      setSnapshotMessage(
        "状態の保存に失敗しました。ブラウザの制限などが原因の可能性があります。"
      );
    }
  };

  const handleRestoreSnapshot = () => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) {
        setSnapshotMessage("保存された状態が見つかりませんでした。");
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed.classes || !parsed.relations) {
        setSnapshotMessage("保存データの形式が不正です。");
        return;
      }
      setClasses(parsed.classes as ClassInfo[]);
      setRelations(parsed.relations as RelationInfo[]);
      setSnapshotMessage("最後に保存した状態を復元しました。");
      setCheckMessages([]);
      setScore(null);
    } catch (e) {
      setSnapshotMessage("状態の復元に失敗しました。");
    }
  };

  /* ===== チェック・採点 ===== */

  const handleCheckDiagram = () => {
    const msgs = checkClassDiagram(classPuml);
    setCheckMessages(msgs);
  };

  const handleGrade = () => {
    setGradeErr(null);
    setScore(null);
    if (!classPuml.trim()) {
      setGradeErr(
        "クラス図がまだ作成されていません。先にクラスや関連を編集してください。"
      );
      return;
    }
    if (!classAnswerPuml || !classAnswerPuml.trim()) {
      setGradeErr(
        "この問題には模範クラス図が設定されていません（トップページで classAnswerPuml を設定してください）。"
      );
      return;
    }

    const ansClasses = new Set(parseClassNames(classAnswerPuml));
    const userClasses = new Set(parseClassNames(classPuml));
    const ansRels = new Set(parseRelationsForScore(classAnswerPuml));
    const userRels = new Set(parseRelationsForScore(classPuml));

    const classInter = [...ansClasses].filter((c) => userClasses.has(c));
    const relInter = [...ansRels].filter((r) => userRels.has(r));

    const classScore =
      ansClasses.size === 0
        ? 0
        : Math.round((classInter.length / ansClasses.size) * 100);
    const relScore =
      ansRels.size === 0
        ? 0
        : Math.round((relInter.length / ansRels.size) * 100);

    const total = Math.round(classScore * 0.6 + relScore * 0.4);

    const comments: string[] = [];
    if (classScore >= 80) {
      comments.push("クラス候補はかなりよく拾えています。");
    } else if (classScore >= 50) {
      comments.push(
        "主要なクラスはある程度拾えていますが、まだ足りないクラスがありそうです。問題文を見直してみましょう。"
      );
    } else {
      comments.push(
        "クラスの抽出が十分ではありません。問題文の登場人物やモノに着目して、クラス候補を増やしてみましょう。"
      );
    }

    if (relScore >= 80) {
      comments.push(
        "クラス間の関連もほぼ模範解答に近いです。多重度の精度をさらに上げられると理想的です。"
      );
    } else if (relScore >= 50) {
      comments.push(
        "関連はだいたい合っていますが、抜けや誤りがいくつかあります。オブジェクト図のリンクと見比べてみましょう。"
      );
    } else {
      comments.push(
        "関連がかなり異なっています。オブジェクト図のリンクをもう一度確認し、どのクラス同士が関係しているか整理してみましょう。"
      );
    }

    setScore({ total, classes: classScore, relations: relScore, comments });
  };

  /* ===== 編集ハンドラ ===== */

  const updateClass = (id: string, updater: (c: ClassInfo) => ClassInfo) => {
    setClasses((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  };

  const updateRelation = (
    id: string,
    updater: (r: RelationInfo) => RelationInfo
  ) => {
    setRelations((prev) => prev.map((r) => (r.id === id ? updater(r) : r)));
  };

  const handleAddClass = () => {
    const newName = `新しいクラス${classes.length + 1}`;
    const id = makeId();
    setClasses((prev) => [
      ...prev,
      {
        id,
        name: newName,
        isAutoNamed: false,
        attrs: [],
      },
    ]);
  };

  const handleDeleteClass = (id: string) => {
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) => prev.filter((r) => r.fromId !== id && r.toId !== id));
  };

  const handleAddRelation = () => {
    const firstId = classes[0]?.id;
    if (!firstId) return;
    setRelations((prev) => [
      ...prev,
      {
        id: makeId(),
        fromId: firstId,
        toId: firstId,
        label: "",
        multFrom: "",
        multTo: "",
        style: "solid",
      },
    ]);
  };

  const handleDeleteRelation = (id: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== id));
  };

  /* ===== JSX ===== */

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* ヘッダ＋クラス図作成問題文 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <h1 className="text-xl font-semibold">
            レベル4：あなたのクラス図を編集する
          </h1>
          <div className="border rounded bg-white">
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-neutral-50 rounded-t">
              <div className="text-sm font-semibold">クラス図作成問題（本文）</div>
            </div>
            <div className="px-3 py-2 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
              {classProblemText
                ? classProblemText
                : "（トップページでクラス図作成問題文を設定してください）"}
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          <button
            type="button"
            className="text-xs px-3 py-1 rounded border bg-neutral-50 hover:bg-neutral-100"
            onClick={() => router.push("/level4")}
          >
            オブジェクト図へ戻る
          </button>
        </div>
      </div>

      {loadErr && (
        <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded p-2">
          {loadErr}
        </div>
      )}

      {/* メイン：左 = 編集 / 右 = プレビュー */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* 左側：クラス・関連・チェック */}
        <div className="lg:col-span-2 space-y-4">
          {/* クラス編集ゾーン */}
          <section className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold">クラスの編集</div>
              <button
                type="button"
                className="text-[11px] px-3 py-1 rounded border bg-emerald-50 hover:bg-emerald-100"
                onClick={handleAddClass}
              >
                クラスを追加
              </button>
            </div>
            <p className="text-[11px] text-neutral-600">
              クラス名・属性名・型を編集すると、右のクラス図プレビューに自動で反映されます。
              「クラス名未定」から始まるクラスは、自分で名前を考えてみましょう。
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {classes.map((c) => {
                const hasAuto = c.name.startsWith("クラス名未定");
                return (
                  <div
                    key={c.id}
                    className={`border rounded p-2 text-[11px] space-y-2 ${
                      hasAuto ? "bg-amber-50 border-amber-300" : "bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-[11px] text-neutral-600 mb-0.5">
                          クラス名
                        </div>
                        <input
                          className="w-full border rounded px-2 py-1 bg-white"
                          value={c.name}
                          onChange={(e) => {
                            const newName = e.target.value;
                            updateClass(c.id, (prev) => ({
                              ...prev,
                              name: newName,
                              isAutoNamed: newName.startsWith("クラス名未定"),
                            }));
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded border border-red-300 text-red-600 bg-white hover:bg-red-50"
                        onClick={() => handleDeleteClass(c.id)}
                      >
                        削除
                      </button>
                    </div>
                    {hasAuto && (
                      <div className="text-[10px] text-amber-800">
                        ※ 自動推定されたクラスです。問題文やオブジェクト図を見ながら、適切なクラス名を考えてみましょう。
                      </div>
                    )}

                    <div className="border rounded bg-white p-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold">
                          属性一覧
                        </span>
                        <button
                          type="button"
                          className="text-[10px] px-2 py-0.5 rounded border bg-neutral-50 hover:bg-neutral-100"
                          onClick={() =>
                            updateClass(c.id, (prev) => ({
                              ...prev,
                              attrs: [
                                ...prev.attrs,
                                {
                                  id: makeId(),
                                  name: "新しい属性",
                                  type: "string",
                                  status: "none",
                                },
                              ],
                            }))
                          }
                        >
                          属性を追加
                        </button>
                      </div>
                      {c.attrs.length === 0 && (
                        <div className="text-[10px] text-neutral-400 px-1 pb-1">
                          属性はまだありません。必要に応じて追加してみましょう。
                        </div>
                      )}
                      <div className="space-y-1">
                        {c.attrs.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-1 text-[10px]"
                          >
                            <input
                              className="flex-1 border rounded px-1 py-0.5"
                              value={a.name}
                              onChange={(e) =>
                                updateClass(c.id, (prev) => ({
                                  ...prev,
                                  attrs: prev.attrs.map((x) =>
                                    x.id === a.id
                                      ? { ...x, name: e.target.value }
                                      : x
                                  ),
                                }))
                              }
                            />
                            <span className="text-neutral-600">:</span>
                            <select
                              className="w-20 border rounded px-1 py-0.5"
                              value={a.type}
                              onChange={(e) =>
                                updateClass(c.id, (prev) => ({
                                  ...prev,
                                  attrs: prev.attrs.map((x) =>
                                    x.id === a.id
                                      ? { ...x, type: e.target.value }
                                      : x
                                  ),
                                }))
                              }
                            >
                              <option value="string">string</option>
                              <option value="int">int</option>
                              <option value="real">real</option>
                              <option value="boolean">boolean</option>
                              <option value="other">other</option>
                            </select>
                            {a.status !== "none" && (
                              <button
                                type="button"
                                className={`px-1.5 py-0.5 rounded ${
                                  a.status === "incomplete"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-red-100 text-red-700"
                                }`}
                                onClick={() =>
                                  updateClass(c.id, (prev) => ({
                                    ...prev,
                                    attrs: prev.attrs.map((x) =>
                                      x.id === a.id
                                        ? { ...x, status: "none" }
                                        : x
                                    ),
                                  }))
                                }
                              >
                                {a.status === "incomplete"
                                  ? "要確認 (修正済みにする)"
                                  : "型の矛盾 (修正済みにする)"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="px-1 py-0.5 rounded border bg-neutral-50 hover:bg-neutral-100"
                              onClick={() =>
                                updateClass(c.id, (prev) => ({
                                  ...prev,
                                  attrs: prev.attrs.filter(
                                    (x) => x.id !== a.id
                                  ),
                                }))
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {unnamedClassIds.length > 0 && (
              <div className="text-[11px] text-amber-800">
                ※ 「クラス名未定」で始まるクラスがまだ残っています。可能であれば、それぞれに意味のある名前を付けてみましょう。
              </div>
            )}
          </section>

          {/* 関連編集ゾーン */}
          <section className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold">関連と多重度の編集</div>
              <button
                type="button"
                className="text-[11px] px-3 py-1 rounded border bg-emerald-50 hover:bg-emerald-100"
                onClick={handleAddRelation}
                disabled={classes.length === 0}
              >
                関連を追加
              </button>
            </div>
            <p className="text-[11px] text-neutral-600">
              どのクラス同士が関係しているか、多重度がどうなっているかを確認・修正します。
              不要な関連は「削除」ボタンで消すことができます。
            </p>

            {relations.length === 0 && (
              <div className="text-[11px] text-neutral-400">
                現在、関連はありません。必要に応じて「関連を追加」ボタンから追加できます。
              </div>
            )}

            <div className="space-y-2">
              {relations.map((r) => (
                <div
                  key={r.id}
                  className={`border rounded p-2 text-[11px] flex flex-wrap items-center gap-2 ${
                    r.style === "dotted"
                      ? "bg-neutral-50 border-dashed"
                      : "bg-neutral-50"
                  }`}
                >
                  <select
                    className="border rounded px-1 py-0.5"
                    value={r.fromId}
                    onChange={(e) =>
                      updateRelation(r.id, (prev) => ({
                        ...prev,
                        fromId: e.target.value,
                      }))
                    }
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-20 border rounded px-1 py-0.5"
                    value={r.multFrom}
                    onChange={(e) =>
                      updateRelation(r.id, (prev) => ({
                        ...prev,
                        multFrom: e.target.value,
                      }))
                    }
                  >
                    <option value="">(なし)</option>
                    <option value="1">1</option>
                    <option value="0..1">0..1</option>
                    <option value="1..*">1..*</option>
                    <option value="0..*">0..*</option>
                  </select>
                  <span>—</span>
                  <input
                    className="flex-1 border rounded px-1 py-0.5"
                    placeholder="関連の名前（任意）"
                    value={r.label}
                    onChange={(e) =>
                      updateRelation(r.id, (prev) => ({
                        ...prev,
                        label: e.target.value,
                      }))
                    }
                  />
                  <span>→</span>
                  <select
                    className="border rounded px-1 py-0.5"
                    value={r.toId}
                    onChange={(e) =>
                      updateRelation(r.id, (prev) => ({
                        ...prev,
                        toId: e.target.value,
                      }))
                    }
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-20 border rounded px-1 py-0.5"
                    value={r.multTo}
                    onChange={(e) =>
                      updateRelation(r.id, (prev) => ({
                        ...prev,
                        multTo: e.target.value,
                      }))
                    }
                  >
                    <option value="">(なし)</option>
                    <option value="1">1</option>
                    <option value="0..1">0..1</option>
                    <option value="1..*">1..*</option>
                    <option value="0..*">0..*</option>
                  </select>
                  <label className="inline-flex items-center gap-1 ml-2">
                    <input
                      type="checkbox"
                      className="border rounded"
                      checked={r.style === "dotted"}
                      onChange={(e) =>
                        updateRelation(r.id, (prev) => ({
                          ...prev,
                          style: e.target.checked ? "dotted" : "solid",
                        }))
                      }
                    />
                    <span>不確かな関連（点線）</span>
                  </label>
                  <button
                    type="button"
                    className="ml-auto px-2 py-0.5 rounded border border-red-300 text-red-600 bg-white hover:bg-red-50"
                    onClick={() => handleDeleteRelation(r.id)}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* チェック＆採点＋保存/復元 */}
          <section className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border"
                onClick={handleCheckDiagram}
              >
                クラス図の整合性チェック
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded border"
                onClick={handleGrade}
              >
                模範クラス図と比較して採点
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded border bg-blue-50 hover:bg-blue-100"
                onClick={handleSaveSnapshot}
              >
                状態を保存
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded border bg-purple-50 hover:bg-purple-100"
                onClick={handleRestoreSnapshot}
              >
                最後の保存状態に戻る
              </button>
            </div>

            {snapshotMessage && (
              <div className="text-[11px] text-neutral-700">
                {snapshotMessage}
              </div>
            )}

            {checkMessages.length > 0 && (
              <div className="border rounded p-2 bg-neutral-50 text-[11px] space-y-1">
                <div className="font-semibold mb-1">
                  クラス図の整合性チェック結果
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {checkMessages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {gradeErr && (
              <div className="text-xs text-red-600">{gradeErr}</div>
            )}

            {score && (
              <div className="border rounded p-2 bg-neutral-50 text-[11px] space-y-1">
                <div className="font-semibold">
                  採点結果：総合 {score.total} 点
                </div>
                <div>・クラス抽出：{score.classes} 点</div>
                <div>・関連抽出：{score.relations} 点</div>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  {score.comments.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* 右側：あなたのクラス図プレビュー（スクロールに追従） */}
        <div className="lg:col-span-1">
          <section className="rounded-lg border bg-white p-4 space-y-2 lg:sticky lg:top-4">
            <div className="text-xs font-semibold">
              あなたのクラス図（プレビュー）
            </div>
            <p className="text-[11px] text-neutral-600">
              左側でクラスや関連を編集すると、このクラス図が自動で更新されます。
            </p>
            {currentUrl ? (
              <div className="flex items-center justify-center max-h-[520px] overflow-auto bg-neutral-50 rounded">
                <img
                  alt="current-class-uml"
                  src={currentUrl}
                  className="w-full h-auto"
                />
              </div>
            ) : (
              <div className="text-[11px] text-neutral-400 p-2 text-center">
                クラスや関連を編集すると、ここにクラス図が表示されます。
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
