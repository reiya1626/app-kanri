// app/level4/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useProblemConfig } from "../../components/problem-config";
import { LinkMiniAdder } from "../../components/LinkMiniAdder";
import type { Obj, Link, Attr } from "@/types";
import { generatePlantUMLUrl } from "@/utils/plantuml";

type Snapshot = { objects: Obj[]; links: Link[] };

type ConvertResponse = {
  classPuml: string;
  encodedPuml: string;
  issues?: {
    classes: Array<{
      name: string;
      incomplete: string[];
      contradictory: string[];
    }>;
  };
};

type ScoreBreakdown = {
  total: number;
  classes: number;
  relations: number;
  comments: string[];
};

type InferenceHints = {
  classHints: string[];
  relationHints: string[];
  attrHints: string[];
};

const LEVEL4_STORAGE_KEY = "level4-state-v1";

/* ================= ユーティリティ関数 ================= */

// 末尾の数字を落として「語幹」を作る（例: 商品1 → 商品）
function stemObjectName(name: string): string {
  return name.replace(/[\d０-９]+$/u, "").trim();
}

// オブジェクト名からクラス名候補を作る（語幹が空なら元の名前）
function baseClassNameFromObjectName(name: string): string {
  const trimmed = name.trim();
  const stem = stemObjectName(trimmed);
  return stem || trimmed;
}

// キーワードをハイライトして問題文を表示
function renderHighlightedText(
  text: string,
  keywords: string[]
): React.ReactNode {
  if (!text) return "（問題文が未設定です）";
  const uniq = Array.from(new Set(keywords.filter((k) => k && k.length > 0)));
  if (uniq.length === 0) return text;

  const escaped = uniq.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const regex = new RegExp(`(${escaped.join("|")})`, "g");

  const parts = text.split(regex);
  return parts.map((part, i) => {
    if (uniq.includes(part)) {
      return (
        <mark
          key={i}
          className="bg-yellow-200 rounded px-0.5"
          title="オブジェクト候補／クラス候補"
        >
          {part}
        </mark>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// PlantUML からクラス名一覧を抜き出す
function parseClassNames(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const names: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*class\s+([^\s{]+)/);
    if (m) names.push(m[1].trim());
  }
  return Array.from(new Set(names));
}

// PlantUML から「関連 A -- B」を抽出して正規化キーにする
function parseRelations(puml: string): string[] {
  const lines = puml.split(/\r?\n/);
  const rels: string[] = [];
  for (const line of lines) {
    if (!line.includes("--")) continue;
    if (line.trim().startsWith("@")) continue; // @startuml などは無視
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

// クラス図の簡易整合性チェック
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

// 推定ルールの「ちょっとだけ見せる」ためのメッセージ生成
function buildInferenceHints(
  objects: Obj[],
  links: Link[],
  clsPreviewPuml: string | null,
  issues: ConvertResponse["issues"] | undefined
): InferenceHints {
  const classHints: string[] = [];
  const relationHints: string[] = [];
  const attrHints: string[] = [];

  // クラス生成の理由
  if (objects.length > 0) {
    const classToObjs = new Map<string, string[]>();
    for (const o of objects) {
      if (!o.name) continue;
      const c = baseClassNameFromObjectName(o.name);
      if (!classToObjs.has(c)) classToObjs.set(c, []);
      classToObjs.get(c)!.push(o.name);
    }

    for (const [cls, objNames] of classToObjs.entries()) {
      if (objNames.length >= 2) {
        const sample = objNames.slice(0, 3).join("」「");
        const more =
          objNames.length > 3 ? `」など、合計 ${objNames.length} 個` : "」";
        classHints.push(
          `オブジェクト「${sample}${more}があり、末尾の番号などを取り除くと同じ名前になるため、クラス「${cls}」としてまとめて推定しています。`
        );
      } else if (objNames.length === 1) {
        classHints.push(
          `オブジェクト名「${objNames[0]}」が 1 個だけ観測されたので、そのままクラス「${cls}」として扱っています。`
        );
      }
    }
  }

  // 関連生成の理由（リンクから）
  if (links.length > 0 && objects.length > 0) {
    type RelKey = string;
    const relMap = new Map<
      RelKey,
      { fromClass: string; toClass: string; examples: Link[] }
    >();

    const objClassMap = new Map<string, string>();
    for (const o of objects) {
      if (!o.name) continue;
      objClassMap.set(o.name, baseClassNameFromObjectName(o.name));
    }

    for (const l of links) {
      const fc = objClassMap.get(l.from);
      const tc = objClassMap.get(l.to);
      if (!fc || !tc) continue;
      const key = `${fc}::${tc}`;
      if (!relMap.has(key)) {
        relMap.set(key, { fromClass: fc, toClass: tc, examples: [] });
      }
      relMap.get(key)!.examples.push(l);
    }

    for (const info of relMap.values()) {
      const ex = info.examples[0];
      const labelText = ex.label?.trim() || "〜する";
      relationHints.push(
        `オブジェクト「${ex.from}」は、「${ex.to}」を「${labelText}」という関係で結んでいるため、クラス「${info.fromClass}」と「${info.toClass}」の間に関連を引いています。`
      );
    }
  }

  // 属性の incomplete / contradictory に関する説明
  if (issues && issues.classes && issues.classes.length > 0) {
    for (const c of issues.classes) {
      if (c.incomplete && c.incomplete.length > 0) {
        const list = c.incomplete.join("」「");
        attrHints.push(
          `クラス「${c.name}」のスロット「${list}」は、値が空のまま観測されたケースがあり、まだ型を決めきれないため「<?>」として表示しています。`
        );
      }
      if (c.contradictory && c.contradictory.length > 0) {
        const list = c.contradictory.join("」「");
        attrHints.push(
          `クラス「${c.name}」のスロット「${list}」では、異なる種類の値が混在していたため、型が矛盾しているとみなして「<!>」として表示しています。`
        );
      }
    }
  }

  return { classHints, relationHints, attrHints };
}

/* ================= メインページコンポーネント ================= */

export default function Level4Page() {
  const { classProblemText, objectProblemText, classAnswerPuml } =
    useProblemConfig();

  // オブジェクト図状態
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const snapshot = useMemo<Snapshot>(() => ({ objects, links }), [objects, links]);

  const isEmptySnapshot = (s: Snapshot) =>
    (!s.objects || s.objects.length === 0) &&
    (!s.links || s.links.length === 0);

  // オブジェクト図プレビュー
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [objErr, setObjErr] = useState("");

  useEffect(() => {
    if (isEmptySnapshot(snapshot)) {
      setObjPumlUrl("");
      setObjErr("");
      return;
    }

    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/object-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setObjErr(j?.error || `HTTP ${res.status}`);
          setObjPumlUrl("");
        } else {
          setObjErr("");
          setObjPumlUrl(j?.urlSvg || j?.url || "");
        }
      } catch (e: any) {
        setObjErr(e?.message || "fetch error");
        setObjPumlUrl("");
      }
    }, 350);

    return () => clearTimeout(id);
  }, [snapshot]);

  // クラス図プレビュー（推定結果）
  const [clsPreviewPuml, setClsPreviewPuml] = useState<string | null>(null);
  const [clsPreviewUrl, setClsPreviewUrl] = useState("");
  const [clsIssues, setClsIssues] = useState<ConvertResponse["issues"]>();
  const [clsErr, setClsErr] = useState("");

  useEffect(() => {
    if (isEmptySnapshot(snapshot)) {
      setClsPreviewPuml(null);
      setClsPreviewUrl("");
      setClsIssues(undefined);
      setClsErr("");
      return;
    }

    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: snapshot.objects,
            links: snapshot.links,
          }),
        });
        const j: ConvertResponse = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          setClsErr((j as any)?.error || `HTTP ${res.status}`);
          setClsPreviewPuml(null);
          setClsPreviewUrl("");
          setClsIssues(undefined);
        } else {
          setClsErr("");
          setClsPreviewPuml(j.classPuml);
          const url = j.encodedPuml
            ? `https://www.plantuml.com/plantuml/svg/${j.encodedPuml}`
            : generatePlantUMLUrl(j.classPuml);
          setClsPreviewUrl(url);
          setClsIssues(j.issues);
        }
      } catch (e: any) {
        setClsErr(e?.message || "fetch error");
        setClsPreviewPuml(null);
        setClsPreviewUrl("");
        setClsIssues(undefined);
      }
    }, 350);

    return () => clearTimeout(id);
  }, [snapshot]);

  // 学習者が編集する確定クラス図
  const [finalClassPuml, setFinalClassPuml] = useState("");
  const [finalClassUrl, setFinalClassUrl] = useState("");
  const hasFinal = finalClassPuml.trim().length > 0;

  useEffect(() => {
    if (!hasFinal) {
      setFinalClassUrl("");
      return;
    }
    setFinalClassUrl(generatePlantUMLUrl(finalClassPuml));
  }, [finalClassPuml, hasFinal]);

  // クラス図整合性チェック結果
  const [checkMessages, setCheckMessages] = useState<string[]>([]);

  // 採点結果
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [gradeErr, setGradeErr] = useState<string | null>(null);

  // 推定理由メッセージ
  const inferenceHints = useMemo(
    () => buildInferenceHints(objects, links, clsPreviewPuml, clsIssues),
    [objects, links, clsPreviewPuml, clsIssues]
  );

  // セーブ・ロード
  const handleSaveState = () => {
    if (typeof window === "undefined") return;
    const data = {
      objects,
      links,
      finalClassPuml,
    };
    localStorage.setItem(LEVEL4_STORAGE_KEY, JSON.stringify(data));
    alert("現在の状態を保存しました。");
  };

  const handleLoadState = () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(LEVEL4_STORAGE_KEY);
    if (!raw) {
      alert("保存された状態が見つかりませんでした。");
      return;
    }
    try {
      const data = JSON.parse(raw);
      setObjects(data.objects ?? []);
      setLinks(data.links ?? []);
      setFinalClassPuml(data.finalClassPuml ?? "");
      setCheckMessages([]);
      setScore(null);
      alert("保存された状態を読み込みました。");
    } catch (e) {
      alert("保存データの読み込みに失敗しました。");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(LEVEL4_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      setObjects(data.objects ?? []);
      setLinks(data.links ?? []);
      setFinalClassPuml(data.finalClassPuml ?? "");
    } catch {
      // 読み込み失敗時は何もしない
    }
  }, []);

  // プレビュー → 確定クラス図へコピー
  const handleConvertToEditable = () => {
    if (!clsPreviewPuml) {
      alert(
        "まだクラス図の推定結果がありません。オブジェクト図を先に作ってください。"
      );
      return;
    }
    setFinalClassPuml(clsPreviewPuml);
    setCheckMessages([]);
    setScore(null);
  };

  const handleClearAll = () => {
    if (
      objects.length ||
      links.length ||
      objPumlUrl ||
      clsPreviewPuml ||
      hasFinal
    ) {
      if (
        !confirm(
          "入力内容・プレビュー・クラス図の確定版をすべてクリアしますか？"
        )
      ) {
        return;
      }
    }
    setObjects([]);
    setLinks([]);
    setObjPumlUrl("");
    setObjErr("");
    setClsPreviewPuml(null);
    setClsPreviewUrl("");
    setClsIssues(undefined);
    setClsErr("");
    setFinalClassPuml("");
    setFinalClassUrl("");
    setCheckMessages([]);
    setScore(null);
  };

  // キーワードハイライト用：オブジェクト名の語幹一覧
  const objectStems = useMemo(
    () =>
      Array.from(
        new Set(
          objects
            .map((o) => stemObjectName(o.name))
            .filter((s) => s && s.length > 0)
        )
      ),
    [objects]
  );

  // 差分強調用：クラス名セット
  const previewClassNames =
    clsPreviewPuml && clsPreviewPuml.trim()
      ? parseClassNames(clsPreviewPuml)
      : [];
  const previewClassSet = new Set(previewClassNames);
  const objectStemSet = new Set(objectStems);

  const objToClass = objectStems.filter((s) => previewClassSet.has(s));
  const onlyObj = objectStems.filter((s) => !previewClassSet.has(s));
  const onlyClass = previewClassNames.filter((c) => !objectStemSet.has(c));

  // クラス図整合性チェック
  const handleCheckDiagram = () => {
    const msgs = checkClassDiagram(finalClassPuml);
    setCheckMessages(msgs);
  };

  // 採点
  const handleGrade = () => {
    setGradeErr(null);
    setScore(null);
    if (!finalClassPuml.trim()) {
      setGradeErr(
        "クラス図がまだ作成されていません。先にクラス図を確定・編集してください。"
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
    const userClasses = new Set(parseClassNames(finalClassPuml));
    const ansRels = new Set(parseRelations(classAnswerPuml));
    const userRels = new Set(parseRelations(finalClassPuml));

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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 上部：問題文表示 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">
            レベル4：オブジェクト図からクラス図へ（プレビュー＋確定版）
          </h1>
          {/* ★ グローバル操作ボタン（色付きで横並び） */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1 rounded border bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
              onClick={handleClearAll}
            >
              すべてクリア
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded border bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
              onClick={handleSaveState}
            >
              状態を保存
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded border bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
              onClick={handleLoadState}
            >
              保存状態を読み込み
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-semibold mb-1">
              クラス図作成問題（本文）
            </div>
            <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {classProblemText
                ? renderHighlightedText(classProblemText, objectStems)
                : "（トップページでクラス図問題文を設定してください）"}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1">
              ※ 現在入力されているオブジェクト名に似た語を自動でハイライトしています（オブジェクト候補／クラス候補）。
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold mb-1">
              オブジェクト図作成問題（本文）
            </div>
            <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {objectProblemText
                ? renderHighlightedText(objectProblemText, objectStems)
                : "（トップページでオブジェクト図問題文を設定してください）"}
            </div>
          </div>
        </div>

        <div className="text-xs text-neutral-500">
          ※ 問題文のアップロード・設定処理はトップページのまま利用しています。
        </div>
      </section>

      {/* 下部：左＝入力 / 右＝プレビュー＆クラス図 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：オブジェクトとリンクの入力 */}
        <section className="rounded-lg border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              ステップ1：問題文からオブジェクト・リンクを入力しよう
            </h2>
            {/* ここにはもう「すべてクリア」ボタンは置かない */}
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold mb-1">オブジェクト入力</div>
              <ManualObjectsForm objects={objects} setObjects={setObjects} />
            </div>

            <div>
              <div className="text-xs font-semibold mb-1">リンク入力</div>
              <LinkMiniAdder objects={objects} links={links} setLinks={setLinks} />
            </div>

            <div className="text-xs text-neutral-500">
              ※ オブジェクトやリンクを編集すると、右側のプレビューが自動更新されます。
            </div>
          </div>
        </section>

        {/* 右：プレビュー＋クラス図 */}
        <div className="space-y-4">
          {/* オブジェクト図プレビュー */}
          <section className="rounded-lg border bg-white">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold text-sm">
                （入力中のプレビュー）オブジェクト図
              </div>
            </div>
            <div className="p-4">
              {objErr && (
                <div className="text-xs text-red-600 mb-2">
                  API error: {objErr}
                </div>
              )}
              {objPumlUrl ? (
                <img alt="object-uml" src={objPumlUrl} />
              ) : (
                <div className="text-xs text-neutral-500">
                  オブジェクトやリンクを追加すると、ここにオブジェクト図が表示されます。
                </div>
              )}
            </div>
          </section>

          {/* 推定クラス図プレビュー（編集不可）＋ 差分強調＋推定ルール説明＋推定理由 */}
          <section className="rounded-lg border bg-white">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold text-sm">クラス図（推定プレビュー）</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded border"
                onClick={handleConvertToEditable}
                disabled={!clsPreviewPuml}
              >
                この推定結果をもとにクラス図を作る
              </button>
            </div>
            <div className="p-4 space-y-3">
              {clsErr && (
                <div className="text-xs text-red-600 mb-2">
                  API error: {clsErr}
                </div>
              )}
              {clsPreviewUrl ? (
                <img alt="class-uml-preview" src={clsPreviewUrl} />
              ) : (
                <div className="text-xs text-neutral-500">
                  オブジェクト図ができると、ここにクラス図の推定結果が表示されます。
                </div>
              )}

              {/* 差分強調（オブジェクト名とクラス名） */}
              {(objToClass.length > 0 ||
                onlyObj.length > 0 ||
                onlyClass.length > 0) && (
                <div className="border-t pt-2">
                  <div className="text-xs font-semibold mb-1">
                    オブジェクト名とクラス名の対応（ざっくり）
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="font-semibold mb-1">クラスになった候補</div>
                      <div className="flex flex-wrap gap-1">
                        {objToClass.length > 0 ? (
                          objToClass.map((s) => (
                            <span
                              key={s}
                              className="px-1.5 py-0.5 rounded bg-green-100"
                            >
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-neutral-400">（まだありません）</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">
                        オブジェクトにしかない名前
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {onlyObj.length > 0 ? (
                          onlyObj.map((s) => (
                            <span
                              key={s}
                              className="px-1.5 py-0.5 rounded bg-orange-100"
                            >
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-neutral-400">（なし）</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">
                        クラスにしかない名前
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {onlyClass.length > 0 ? (
                          onlyClass.map((s) => (
                            <span
                              key={s}
                              className="px-1.5 py-0.5 rounded bg-blue-100"
                            >
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-neutral-400">（なし）</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 推定ルールの簡易説明（固定テキスト） */}
              <div className="border-t pt-2 text-[11px] text-neutral-700 space-y-1">
                <div className="font-semibold">推定ルール（全体のイメージ）</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    同じような名前のオブジェクトが複数あると、クラス候補として推定されます。
                  </li>
                  <li>オブジェクト間のリンクから、クラス間の関連が推定されます。</li>
                  <li>
                    スロット（属性）の値のパターンから、クラスの属性候補が推定されます。
                  </li>
                </ul>
              </div>

              {/* 推定の理由（例） */}
              {(inferenceHints.classHints.length > 0 ||
                inferenceHints.relationHints.length > 0 ||
                inferenceHints.attrHints.length > 0) && (
                <div className="border-t pt-2 text-[11px] text-neutral-700 space-y-1">
                  <div className="font-semibold mb-1">
                    推定の理由（例） ― ツールがどう考えているか
                  </div>

                  {inferenceHints.classHints.length > 0 && (
                    <div>
                      <div className="font-semibold">クラスの推定</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {inferenceHints.classHints.map((h, i) => (
                          <li key={`ch-${i}`}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {inferenceHints.relationHints.length > 0 && (
                    <div>
                      <div className="font-semibold mt-1">関連の推定</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {inferenceHints.relationHints.map((h, i) => (
                          <li key={`rh-${i}`}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {inferenceHints.attrHints.length > 0 && (
                    <div>
                      <div className="font-semibold mt-1">
                        属性（スロット）の状態
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {inferenceHints.attrHints.map((h, i) => (
                          <li key={`ah-${i}`}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="text-[10px] text-neutral-500 mt-1">
                    ※ すべてのルールを完全に説明しているわけではなく、「だいたいこういう考え方で推定しています」という目安です。
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 学習者が編集するクラス図（確定版）＋ 見比べ＋チェック＋採点 */}
          {hasFinal && (
            <section className="rounded-lg border bg-white">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-semibold text-sm">あなたのクラス図（編集用）</div>
                <div className="text-xs text-neutral-500">
                  ※ ここはオブジェクト図を変えても自動更新されません。
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-xs">
                  推定結果をもとに、クラス名・属性名・多重度などを自分なりに修正してみてください。
                </div>

                <textarea
                  className="w-full border rounded p-2 text-xs font-mono h-40"
                  value={finalClassPuml}
                  onChange={(e) => {
                    setFinalClassPuml(e.target.value);
                    setCheckMessages([]);
                    setScore(null);
                  }}
                />

                {/* 推定図との見比べ（左右２分割） */}
                <div className="border rounded p-2 bg-neutral-50 space-y-2">
                  <div className="text-xs font-semibold mb-1">
                    推定クラス図とあなたのクラス図の見比べ
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
                    <div className="border rounded p-1 bg-white">
                      <div className="text-[11px] text-center text-neutral-600">
                        推定クラス図
                      </div>
                      {clsPreviewUrl ? (
                        <img alt="preview-class-uml" src={clsPreviewUrl} />
                      ) : (
                        <div className="text-[11px] text-neutral-400 p-2 text-center">
                          推定クラス図がありません。
                        </div>
                      )}
                    </div>
                    <div className="border rounded p-1 bg-white">
                      <div className="text-[11px] text-center text-neutral-600">
                        あなたのクラス図
                      </div>
                      {finalClassUrl ? (
                        <img alt="final-class-uml" src={finalClassUrl} />
                      ) : (
                        <div className="text-[11px] text-neutral-400 p-2 text-center">
                          クラス図テキストを編集すると、ここに図が表示されます。
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* チェック＆採点ボタン */}
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

                {/* 整合性チェック結果 */}
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

                {/* 採点結果 */}
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
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============== オブジェクト入力フォーム =============== */
/* 型（クラス名）は入力しない。
   オブジェクトごとに「スロット名」「スロット値」を複数追加できる。 */

type ManualObjectsFormProps = {
  objects: Obj[];
  setObjects: (next: Obj[]) => void;
};

function ManualObjectsForm({ objects, setObjects }: ManualObjectsFormProps) {
  const addObject = () =>
    setObjects([
      ...objects,
      { name: "", attrs: [] as Attr[] },
    ]);

  const updateName = (idx: number, name: string) => {
    const next = [...objects];
    next[idx] = { ...next[idx], name };
    setObjects(next);
  };

  const removeObject = (idx: number) => {
    const next = [...objects];
    next.splice(idx, 1);
    setObjects(next);
  };

  const updateAttr = (
    objIdx: number,
    attrIdx: number,
    patch: { key?: string; value?: string }
  ) => {
    const next = [...objects];
    const obj = next[objIdx];
    const attrs = [...(obj.attrs ?? [])];
    const current = attrs[attrIdx] || { key: "", value: "" };
    attrs[attrIdx] = { ...current, ...patch };
    next[objIdx] = { ...obj, attrs };
    setObjects(next);
  };

  const addAttr = (objIdx: number) => {
    const next = [...objects];
    const obj = next[objIdx];
    const attrs = [...(obj.attrs ?? [])];
    attrs.push({ key: "", value: "" });
    next[objIdx] = { ...obj, attrs };
    setObjects(next);
  };

  const removeAttr = (objIdx: number, attrIdx: number) => {
    const next = [...objects];
    const obj = next[objIdx];
    const attrs = [...(obj.attrs ?? [])];
    attrs.splice(attrIdx, 1);
    next[objIdx] = { ...obj, attrs };
    setObjects(next);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-xs px-3 py-1 rounded border"
        onClick={addObject}
      >
        ＋ オブジェクトを追加
      </button>

      <div className="space-y-2">
        {objects.map((o, idx) => (
          <div key={idx} className="rounded border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-xs text-neutral-500">オブジェクト名</div>
              <input
                className="border rounded px-2 py-1 w-full text-xs"
                placeholder="例: 会員1, 商品A など"
                value={o.name}
                onChange={(e) => updateName(idx, e.target.value)}
              />
              <button
                type="button"
                className="text-[10px] px-2 py-1 rounded border"
                onClick={() => removeObject(idx)}
              >
                削除
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] text-neutral-500">スロット一覧</div>
              {(o.attrs ?? []).map((a, aidx) => (
                <div key={aidx} className="flex items-center gap-2">
                  <input
                    className="border rounded px-2 py-1 w-32 text-[10px]"
                    placeholder="スロット名（例：価格）"
                    value={a.key}
                    onChange={(e) =>
                      updateAttr(idx, aidx, { key: e.target.value })
                    }
                  />
                  <input
                    className="border rounded px-2 py-1 flex-1 text-[10px]"
                    placeholder='値（例："2980" や "商品A"）'
                    value={a.value}
                    onChange={(e) =>
                      updateAttr(idx, aidx, { value: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="text-[10px] px-2 py-1 rounded border"
                    onClick={() => removeAttr(idx, aidx)}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-[10px] px-2 py-1 rounded border"
                onClick={() => addAttr(idx)}
              >
                ＋ スロットを追加
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-neutral-500">
        ※ 型（クラス名）はここでは入力しなくて構いません。<br />
        ※ スロット名と値を、できるだけ問題文に合わせて入力してみましょう。
      </div>
    </div>
  );
}
