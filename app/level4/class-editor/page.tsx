// app/level4/class-editor/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProblemConfig } from "@/components/problem-config";
import { generatePlantUMLUrl } from "@/utils/plantuml";
import type { Obj, Link } from "@/types";

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

/* ==== ここは level4/page.tsx から持ってきたユーティリティの一部 ==== */

function parseClassNames(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const names: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*class\s+([^\s{]+)/);
    if (m) names.push(m[1].trim());
  }
  return Array.from(new Set(names));
}

function parseRelations(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const rels: string[] = [];
  for (const line of lines) {
    if (!line.includes("--")) continue;
    if (line.trim().startsWith("@")) continue;
    const m = line.match(
      /^\s*([^\s"]+)\s+["0-9.* ]*..?-["0-9.* ]*\s+([^\s"]+)/
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
    if (!line.includes("--")) continue;
    if (line.trim().startsWith("@")) continue;

    const m = line.match(
      /^\s*([^\s"]+)\s+([^-\n"]*)..?-([^"\n]*)\s+([^\s"]+)/
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
  const { classAnswerPuml } = useProblemConfig();

  const [initialClassPuml, setInitialClassPuml] = useState("");
  const [classPuml, setClassPuml] = useState("");
  const [initialUrl, setInitialUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [checkMessages, setCheckMessages] = useState<string[]>([]);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [gradeErr, setGradeErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // レベル4ページから渡された初期値を読み込む
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
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
      setClassPuml(base);
    } catch (e) {
      setLoadErr("保存された推定クラス図の読み込みに失敗しました。");
    }
  }, []);

  // プレビューURLを更新
  useEffect(() => {
    if (!initialClassPuml.trim()) {
      setInitialUrl("");
      return;
    }
    setInitialUrl(generatePlantUMLUrl(initialClassPuml));
  }, [initialClassPuml]);

  useEffect(() => {
    if (!classPuml.trim()) {
      setCurrentUrl("");
      return;
    }
    setCurrentUrl(generatePlantUMLUrl(classPuml));
  }, [classPuml]);

  const handleCheckDiagram = () => {
    const msgs = checkClassDiagram(classPuml);
    setCheckMessages(msgs);
  };

  const handleGrade = () => {
    setGradeErr(null);
    setScore(null);
    if (!classPuml.trim()) {
      setGradeErr(
        "クラス図がまだ作成されていません。先にクラス図を編集してください。"
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
    const ansRels = new Set(parseRelations(classAnswerPuml));
    const userRels = new Set(parseRelations(classPuml));

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

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* ヘッダ */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            レベル4：あなたのクラス図を編集する
          </h1>
          <p className="text-xs text-neutral-600 mt-1">
            オブジェクト図から推定されたクラス図をもとに、自分の考えるクラス図を仕上げましょう。
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* 上：テキストエディタ */}
      <section className="rounded-lg border bg-white p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">あなたのクラス図（PlantUML）</div>
        </div>
        <textarea
          className="w-full border rounded p-2 text-xs font-mono h-48"
          value={classPuml}
          onChange={(e) => {
            setClassPuml(e.target.value);
            setCheckMessages([]);
            setScore(null);
          }}
        />
        <div className="text-[11px] text-neutral-500">
          ※ 推定クラス図を初期値として読み込んでいます。自由に修正して構いません。
        </div>
      </section>

      {/* 中央：推定クラス図 vs あなたのクラス図 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="text-xs font-semibold mb-1">
          推定クラス図とあなたのクラス図の見比べ
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <div className="border rounded p-2 bg-neutral-50">
            <div className="text-[11px] text-center text-neutral-600 mb-1">
              推定クラス図
            </div>
            {initialUrl ? (
              <div className="flex items-center justify-center max-h-[360px] overflow-auto bg-white rounded">
                <img alt="initial-class-uml" src={initialUrl} className="w-full h-auto" />
              </div>
            ) : (
              <div className="text-[11px] text-neutral-400 p-2 text-center">
                推定クラス図が読み込めませんでした。
              </div>
            )}
          </div>
          <div className="border rounded p-2 bg-neutral-50">
            <div className="text-[11px] text-center text-neutral-600 mb-1">
              あなたのクラス図
            </div>
            {currentUrl ? (
              <div className="flex items-center justify-center max-h-[360px] overflow-auto bg-white rounded">
                <img alt="current-class-uml" src={currentUrl} className="w-full h-auto" />
              </div>
            ) : (
              <div className="text-[11px] text-neutral-400 p-2 text-center">
                クラス図テキストを編集すると、ここに図が表示されます。
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 下：チェック＆採点 */}
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
        </div>

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
  );
}
