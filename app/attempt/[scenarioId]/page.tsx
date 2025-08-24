"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Scenario,
  Snapshot,
  Obj,
  Link as LinkType,
  LearnerAttempt,
} from "@/types";

import { Level3Workbench } from "@/components/Level3Workbench";
import { generatePlantUMLUrl } from "@/utils/plantuml";

/* ----------------- 最小のPUML生成ヘルパ ----------------- */
// 必要に応じて既存の関数に置き換えてOK

function toAlias(name: string, idx: number) {
  const clean = name.replace(/[^A-Za-z0-9_]/g, "_");
  return clean ? `${clean}_${idx}` : `obj_${idx}`;
}

function buildObjectPuml(snapshot: Snapshot): string {
  const lines: string[] = ["@startuml"];

  snapshot.objects.forEach((o: Obj, i) => {
    const alias = toAlias(o.name, i);
    const label = o.type && o.type.trim() ? `${o.name}:${o.type.trim()}` : o.name;
    lines.push(`object "${label}" as ${alias}`);
  });

  const aliasByName = new Map<string, string>();
  snapshot.objects.forEach((o, i) => aliasByName.set(o.name, toAlias(o.name, i)));

  snapshot.links.forEach((l: LinkType) => {
    const f = aliasByName.get(l.from);
    const t = aliasByName.get(l.to);
    if (!f || !t) return;
    lines.push(`${f} --> ${t}${l.label ? ` : ${l.label}` : ""}`);
  });

  lines.push("@enduml");
  return lines.join("\n");
}

function buildClassPuml(snapshot: Snapshot): string {
  const lines: string[] = ["@startuml", "skinparam classAttributeIconSize 0"];

  const types = Array.from(
    new Set(
      snapshot.objects
        .map((o) => (o.type || "").trim())
        .filter((t) => t.length > 0),
    ),
  );
  types.forEach((t) => lines.push(`class "${t}"`));

  const typeOf = new Map<string, string>(); // name -> type
  snapshot.objects.forEach((o) => typeOf.set(o.name, (o.type || "").trim()));

  snapshot.links.forEach((l) => {
    const t1 = typeOf.get(l.from) || "";
    const t2 = typeOf.get(l.to) || "";
    if (!t1 || !t2 || t1 === t2) return;
    lines.push(`"${t1}" --> "${t2}"${l.label ? ` : ${l.label}` : ""}`);
  });

  lines.push("@enduml");
  return lines.join("\n");
}
/* ------------------------------------------------------- */

export default function AttemptPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();

  // シナリオ状態
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 「ステップ1の問題文 自動生成中」フラグ
  const [genLoading, setGenLoading] = useState(false);

  // 入力スナップショット
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<LinkType[]>([]);
  const snapshot: Snapshot = useMemo(() => ({ objects, links }), [objects, links]);

  // プレビューURL
  const [objectDiagramUrl, setObjectDiagramUrl] = useState("");
  const [classDiagramUrl, setClassDiagramUrl] = useState("");

  // 提出
  const [submittedAttempt, setSubmittedAttempt] = useState<LearnerAttempt | null>(null);

  /* ---- 1) シナリオ読込（no-store & 優しく） ---- */
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/scenario/${scenarioId}`, { cache: "no-store" });
        if (!res.ok) {
          setLoadError("このシナリオは見つかりませんでした。");
          return;
        }
        const data: Scenario = await res.json();
        setScenario(data);
      } catch (e) {
        console.error(e);
        setLoadError("シナリオの読み込み中にエラーが発生しました。");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [scenarioId]);


  /* ---- 3) プレビュー生成（PlantUML 直リンク） ---- */
  useEffect(() => {
    const has = snapshot.objects.length > 0 || snapshot.links.length > 0;
    if (!has) {
      setObjectDiagramUrl("");
      setClassDiagramUrl("");
      return;
    }
    try {
      const objectPuml = buildObjectPuml(snapshot);
      const classPuml = buildClassPuml(snapshot);
      setObjectDiagramUrl(generatePlantUMLUrl(objectPuml));
      setClassDiagramUrl(generatePlantUMLUrl(classPuml));
    } catch (e) {
      console.error("Failed to generate diagrams:", e);
    }
  }, [snapshot]);

  /* ---- 4) 提出 ---- */
  function handleSubmit() {
    if (!objectDiagramUrl && !classDiagramUrl) {
      alert("オブジェクト図またはクラス図が生成されていません。");
      return;
    }
    if (!scenario) {
      alert("シナリオが読み込めていません。");
      return;
    }
    const attempt: LearnerAttempt = {
      id: Date.now().toString(),
      scenarioId: scenario.id,
      snapshot,
      objectDiagramUrl,
      classDiagramUrl,
      submittedAt: new Date().toISOString(),
    };
    setSubmittedAttempt(attempt);
  }

  /* ---- 表示 ---- */
  if (loading) {
    return <main className="p-6 text-gray-600 text-sm">シナリオを読み込んでいます…</main>;
  }
  if (loadError) {
    return (
      <main className="p-6 text-gray-600 text-sm">
        {loadError}
        <div className="mt-2 text-xs text-gray-400">scenarioId: {String(scenarioId)}</div>
      </main>
    );
  }
  if (!scenario) {
    return <main className="p-6 text-gray-600 text-sm">シナリオ情報が存在しません。</main>;
  }

  return (
    <main className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
      {/* 左ペイン */}
      <section className="space-y-4">
        {/* ステップ2：クラス図課題（本文） */}
        <div className="rounded-xl border p-4 bg-white shadow-sm">
          <h1 className="text-lg font-semibold mb-2">クラス図作成問題（本文）</h1>
          <p className="text-xs text-gray-500 mb-3">シナリオID: {scenario.id}</p>
          <div className="text-sm text-gray-800 whitespace-pre-line">
            {scenario.classProblemText.trim()}
          </div>
        </div>

        {/* ステップ1：オブジェクト図作成問題（自動生成 or 表示） */}
        <div className="rounded-xl border p-4 bg-white shadow-sm">
          <h2 className="text-base font-semibold mb-2">1. オブジェクト図を作成してください</h2>

          {/* ← 生成済みの文章だけを表示 */}
          <div className="text-sm text-gray-700 mb-4 whitespace-pre-line">
            {scenario.objectProblemText?.trim()
              ? scenario.objectProblemText
              : "（オブジェクト図作成問題が設定されていません）"}
          </div>

          {/* レベル3入力UI */}
          <Level3Workbench
            objects={objects}
            setObjects={setObjects}
            links={links}
            setLinks={setLinks}
          />

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSubmit}
              className="px-4 py-2 text-sm font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              disabled={!!submittedAttempt}
            >
              {submittedAttempt ? "提出済み" : "この内容で提出する"}
            </button>
          </div>
        </div>
      </section>

      {/* 右ペイン */}
      <section className="space-y-4">
        <div className="rounded-xl border p-4 bg-white shadow-sm">
          <h2 className="text-base font-semibold mb-2">オブジェクト図プレビュー</h2>
          {objectDiagramUrl ? (
            <img
              src={objectDiagramUrl}
              alt="object diagram preview"
              className="w-full border rounded-lg bg-white"
            />
          ) : (
            <p className="text-xs text-gray-500">まだオブジェクトが入力されていません。</p>
          )}
        </div>

        <div className="rounded-xl border p-4 bg-white shadow-sm">
          <h2 className="text-base font-semibold mb-2">クラス図プレビュー（自動生成）</h2>
          {classDiagramUrl ? (
            <img
              src={classDiagramUrl}
              alt="class diagram preview"
              className="w-full border rounded-lg bg-white"
            />
          ) : (
            <p className="text-xs text-gray-500">
              オブジェクト図から推定したクラス図をここに表示します。
            </p>
          )}
        </div>

        {submittedAttempt && (
          <div className="rounded-xl border p-4 bg-white shadow-sm">
            <h2 className="text-base font-semibold mb-2">あなたの提出内容</h2>
            <p className="text-xs text-gray-500 mb-4">
              提出時刻: {new Date(submittedAttempt.submittedAt).toLocaleString()}
            </p>
            <div className="text-xs text-gray-700 mb-4">
              <p className="font-medium mb-1">オブジェクト一覧</p>
              <ul className="list-disc pl-4">
                {submittedAttempt.snapshot.objects.map((o, i) => (
                  <li key={i}>{o.name}{o.type ? ` : ${o.type}` : ""}</li>
                ))}
              </ul>
              <p className="font-medium mt-3 mb-1">関係一覧</p>
              <ul className="list-disc pl-4">
                {submittedAttempt.snapshot.links.map((l, i) => (
                  <li key={i}>
                    {l.from} → {l.to} {l.label && `(${l.label})`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
