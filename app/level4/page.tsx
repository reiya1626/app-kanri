// app/level4/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useProblemConfig } from "../../components/problem-config";
import { LinkMiniAdder } from "../../components/LinkMiniAdder";
import type { Obj, Link, Attr } from "@/types";
import { generatePlantUMLUrl } from "@/utils/plantuml";
import { useRouter } from "next/navigation";


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

function stemObjectName(name: string): string {
  return name.replace(/[\d０-９]+$/u, "").trim();
}

function baseClassNameFromObjectName(name: string): string {
  const trimmed = name.trim();
  const stem = stemObjectName(trimmed);
  return stem || trimmed;
}

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

function buildInferenceHints(
  objects: Obj[],
  links: Link[],
  clsPreviewPuml: string | null,
  issues: ConvertResponse["issues"] | undefined
): InferenceHints {
  const classHints: string[] = [];
  const relationHints: string[] = [];
  const attrHints: string[] = [];

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

/* ================= モーダルコンポーネント ================= */

type ProblemModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
};

function ProblemModal({ title, children, onClose }: ProblemModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-[90%] max-w-4xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="text-sm font-semibold">{title}</div>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-neutral-50 hover:bg-neutral-100"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        <div className="px-4 py-3 overflow-y-auto text-sm whitespace-pre-wrap">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ================= メインページコンポーネント ================= */

export default function Level4Page() {
  const { classProblemText, objectProblemText, classAnswerPuml } =
    useProblemConfig();
  const router = useRouter();   // ★追加

  // 問題文モーダル
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isObjectModalOpen, setIsObjectModalOpen] = useState(false);

  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const snapshot = useMemo<Snapshot>(() => ({ objects, links }), [objects, links]);

  const isEmptySnapshot = (s: Snapshot) =>
    (!s.objects || s.objects.length === 0) &&
    (!s.links || s.links.length === 0);

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

  const [checkMessages, setCheckMessages] = useState<string[]>([]);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  const [gradeErr, setGradeErr] = useState<string | null>(null);

  const inferenceHints = useMemo(
    () => buildInferenceHints(objects, links, clsPreviewPuml, clsIssues),
    [objects, links, clsPreviewPuml, clsIssues]
  );

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
    } catch {
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
      // ignore
    }
  }, []);

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

  const previewClassNames =
    clsPreviewPuml && clsPreviewPuml.trim()
      ? parseClassNames(clsPreviewPuml)
      : [];
  const previewClassSet = new Set(previewClassNames);
  const objectStemSet = new Set(objectStems);

  const objToClass = objectStems.filter((s) => previewClassSet.has(s));
  const onlyObj = objectStems.filter((s) => !previewClassSet.has(s));
  const onlyClass = previewClassNames.filter((c) => !objectStemSet.has(c));

  const handleCheckDiagram = () => {
    const msgs = checkClassDiagram(finalClassPuml);
    setCheckMessages(msgs);
  };

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
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* ヘッダ：タイトル＋グローバルボタン */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">
            レベル4：オブジェクト図からクラス図へ（プレビュー＋確定版）
          </h1>
        </div>
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

      {/* メイン 3 カラムレイアウト */}
      <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr_1.1fr] gap-4 items-start">
        {/* 左：問題文カラム（スクロール＋全文モーダル） */}
        <section className="rounded-lg border bg-white p-3 space-y-3">
          <div className="space-y-2">
            {/* クラス図作成問題 */}
            <div className="border rounded bg-neutral-50/60">
              <div className="flex items-center justify-between px-3 py-1.5 border-b bg-white rounded-t">
                <div className="text-sm font-semibold">
                  クラス図作成問題（本文）
                </div>
                <button
                  type="button"
                  className="text-[10px] px-2 py-0.5 rounded border bg-neutral-50 hover:bg-neutral-100"
                  onClick={() => setIsClassModalOpen(true)}
                >
                  全文を表示
                </button>
              </div>
              {/* ★ ここ：カード内スクロールで全文読めるようにする */}
              <div className="text-sm whitespace-pre-wrap max-h-40 overflow-y-auto px-3 py-2">
                {classProblemText
                  ? renderHighlightedText(classProblemText, objectStems)
                  : "（トップページでクラス図問題文を設定してください）"}
              </div>
            </div>

            {/* オブジェクト図作成問題 */}
            <div className="border rounded bg-neutral-50/60">
              <div className="flex items-center justify-between px-3 py-1.5 border-b bg-white rounded-t">
                <div className="text-sm font-semibold">
                  オブジェクト図作成問題（本文）
                </div>
                <button
                  type="button"
                  className="text-[10px] px-2 py-0.5 rounded border bg-neutral-50 hover:bg-neutral-100"
                  onClick={() => setIsObjectModalOpen(true)}
                >
                  全文を表示
                </button>
              </div>
              {/* ★ ここも同じくスクロール */}
              <div className="text-sm whitespace-pre-wrap max-h-40 overflow-y-auto px-3 py-2">
                {objectProblemText
                  ? renderHighlightedText(objectProblemText, objectStems)
                  : "（トップページでオブジェクト図問題文を設定してください）"}
              </div>
            </div>
          </div>
        </section>

        {/* 中央：オブジェクト編集＋オブジェクト図プレビュー */}
        <div className="space-y-4">
          <section className="rounded-lg border bg-white p-3">
            <h2 className="font-semibold text-sm mb-1">
              ステップ1-A：オブジェクトを入力する
            </h2>
            <ManualObjectsForm objects={objects} setObjects={setObjects} />
          </section>

          <section className="rounded-lg border bg-white">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="font-semibold text-sm">
                （入力中のプレビュー）オブジェクト図
              </div>
            </div>
            <div className="p-3">
              {objErr && (
                <div className="text-xs text-red-600 mb-2">
                  API error: {objErr}
                </div>
              )}
              <div className="flex items-center justify-center max-h-[360px] min-h-[220px] overflow-auto">
                {objPumlUrl ? (
                  <img
                    alt="object-uml"
                    src={objPumlUrl}
                    className="w-full h-auto"
                  />
                ) : (
                  <div className="text-xs text-neutral-500">
                    オブジェクトやリンクを追加すると、ここにオブジェクト図が表示されます。
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* 右：リンク編集＋クラス図プレビュー */}
        <div className="space-y-4">
          <section className="rounded-lg border bg-white p-3">
            <h2 className="font-semibold text-sm mb-1">
              ステップ1-B：リンクを入力する
            </h2>
            <LinkMiniAdder objects={objects} links={links} setLinks={setLinks} />
          </section>

          <section className="rounded-lg border bg-white">
            <div className="p-3 border-b flex items-center justify-between">
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
            <div className="p-3 space-y-3">
              {clsErr && (
                <div className="text-xs text-red-600 mb-2">
                  API error: {clsErr}
                </div>
              )}

              <div className="flex items-center justify-center max-h-[360px] min-h-[220px] overflow-auto">
                {clsPreviewUrl ? (
                  <img
                    alt="class-uml-preview"
                    src={clsPreviewUrl}
                    className="w-full h-auto"
                  />
                ) : (
                  <div className="text-xs text-neutral-500">
                    オブジェクト図ができると、ここにクラス図の推定結果が表示されます。
                  </div>
                )}
              </div>
              {(objToClass.length > 0 ||
                onlyObj.length > 0 ||
                onlyClass.length > 0) && (
                <div className="border-t pt-2">
                  <div className="text-xs font-semibold mb-1">
                    オブジェクト名とクラス名の対応（ざっくり）
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-[11px]">
                    <div>
                      <div className="font-semibold mb-0.5">クラスになった候補</div>
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
                      <div className="font-semibold mb-0.5">
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
                      <div className="font-semibold mb-0.5">
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
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 下部：学習者のクラス図編集（フル幅） */}
      {hasFinal && (
        <section className="rounded-lg border bg-white mt-2">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">あなたのクラス図（編集用）</div>
          </div>
          <div className="p-4 space-y-3">
            <textarea
              className="w-full border rounded p-2 text-xs font-mono h-40"
              value={finalClassPuml}
              onChange={(e) => {
                setFinalClassPuml(e.target.value);
                setCheckMessages([]);
                setScore(null);
              }}
            />

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
          </div>
        </section>
      )}

      {/* 問題文の全文モーダル */}
      {isClassModalOpen && (
        <ProblemModal
          title="クラス図作成問題（本文）"
          onClose={() => setIsClassModalOpen(false)}
        >
          {classProblemText
            ? renderHighlightedText(classProblemText, objectStems)
            : "（トップページでクラス図問題文を設定してください）"}
        </ProblemModal>
      )}

      {isObjectModalOpen && (
        <ProblemModal
          title="オブジェクト図作成問題（本文）"
          onClose={() => setIsObjectModalOpen(false)}
        >
          {objectProblemText
            ? renderHighlightedText(objectProblemText, objectStems)
            : "（トップページでオブジェクト図問題文を設定してください）"}
        </ProblemModal>
      )}
    </div>
  );
}

/* =============== オブジェクト入力フォーム（一覧＋詳細） =============== */

type ManualObjectsFormProps = {
  objects: Obj[];
  setObjects: (next: Obj[]) => void;
};

function ManualObjectsForm({ objects, setObjects }: ManualObjectsFormProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    objects.length ? 0 : null
  );

  useEffect(() => {
    if (objects.length === 0) {
      setSelectedIndex(null);
    } else if (selectedIndex === null || selectedIndex >= objects.length) {
      setSelectedIndex(0);
    }
  }, [objects.length, selectedIndex]);

  const addObject = () => {
    const next = [...objects, { name: "", attrs: [] as Attr[] }];
    setObjects(next);
    setSelectedIndex(next.length - 1);
  };

  const removeObject = (idx: number) => {
    const next = [...objects];
    next.splice(idx, 1);
    setObjects(next);

    setSelectedIndex((prev) => {
      if (next.length === 0) return null;
      if (prev === null) return 0;
      if (idx === prev) return Math.min(prev, next.length - 1);
      if (idx < prev) return prev - 1;
      return prev;
    });
  };

  const updateSelectedName = (name: string) => {
    if (selectedIndex === null) return;
    const next = [...objects];
    next[selectedIndex] = { ...next[selectedIndex], name };
    setObjects(next);
  };

  const updateAttr = (attrIdx: number, patch: { key?: string; value?: string }) => {
    if (selectedIndex === null) return;
    const next = [...objects];
    const obj = next[selectedIndex];
    const attrs = [...(obj.attrs ?? [])];
    const current = attrs[attrIdx] || { key: "", value: "" };
    attrs[attrIdx] = { ...current, ...patch };
    next[selectedIndex] = { ...obj, attrs };
    setObjects(next);
  };

  const addAttr = () => {
    if (selectedIndex === null) return;
    const next = [...objects];
    const obj = next[selectedIndex];
    const attrs = [...(obj.attrs ?? [])];
    attrs.push({ key: "", value: "" });
    next[selectedIndex] = { ...obj, attrs };
    setObjects(next);
  };

  const removeAttr = (attrIdx: number) => {
    if (selectedIndex === null) return;
    const next = [...objects];
    const obj = next[selectedIndex];
    const attrs = [...(obj.attrs ?? [])];
    attrs.splice(attrIdx, 1);
    next[selectedIndex] = { ...obj, attrs };
    setObjects(next);
  };

  const selectedObj =
    selectedIndex !== null ? objects[selectedIndex] ?? null : null;

  return (
    <div className="space-y-3">
      {/* 一覧 */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold">オブジェクト一覧</div>
        <button
          type="button"
          className="text-xs px-3 py-1 rounded border bg-neutral-50 hover:bg-neutral-100"
          onClick={addObject}
        >
          ＋ オブジェクトを追加
        </button>
      </div>

      <div className="border rounded bg-neutral-50 text-xs max-h-40 overflow-y-auto">
        {objects.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-neutral-500">
            まだオブジェクトがありません。「＋ オブジェクトを追加」から作成してください。
          </div>
        ) : (
          <ul className="divide-y">
            {objects.map((o, idx) => {
              const isSelected = idx === selectedIndex;
              const slotCount = o.attrs?.length ?? 0;
              return (
                <li
                  key={idx}
                  className={
                    "flex items-center justify-between px-2 py-1 cursor-pointer transition-colors " +
                    (isSelected ? "bg-emerald-50" : "hover:bg-neutral-100")
                  }
                  onClick={() => setSelectedIndex(idx)}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white border text-[10px] text-neutral-600">
                      {idx + 1}
                    </span>
                    <span className="text-xs">
                      {o.name || `（名前未設定のオブジェクト${idx + 1}）`}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      スロット数: {slotCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isSelected && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        選択中
                      </span>
                    )}
                    <button
                      type="button"
                      className="px-2 py-0.5 rounded border text-[10px] bg-white hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeObject(idx);
                      }}
                    >
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 詳細編集 */}
      {selectedObj ? (
        <div className="border rounded p-3 space-y-2 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold">
              編集中のオブジェクト：
              {selectedObj.name || `オブジェクト${(selectedIndex ?? 0) + 1}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-xs text-neutral-500">オブジェクト名</div>
            <input
              className="border rounded px-2 py-1 w-full text-xs bg-white"
              placeholder="例: 会員1, 商品A など"
              value={selectedObj.name}
              onChange={(e) => updateSelectedName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            {(selectedObj.attrs ?? []).map((a, aidx) => (
              <div key={aidx} className="flex items-center gap-2">
                <input
                  className="border rounded px-2 py-1 w-32 text-[10px] bg-white"
                  placeholder="スロット名"
                  value={a.key}
                  onChange={(e) =>
                    updateAttr(aidx, { key: e.target.value })
                  }
                />
                <input
                  className="border rounded px-2 py-1 flex-1 text-[10px] bg-white"
                  placeholder='値（例："19" や "太郎"）'
                  value={a.value}
                  onChange={(e) =>
                    updateAttr(aidx, { value: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-red-50"
                  onClick={() => removeAttr(aidx)}
                >
                  削除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-neutral-100"
              onClick={addAttr}
            >
              ＋ スロットを追加
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-neutral-500">
          ※ 編集したいオブジェクトを一覧から選択すると、ここに詳細が表示されます。
        </div>
      )}
    </div>
  );
}
