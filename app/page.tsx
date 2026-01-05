// app/page.tsx
"use client";

import React, { useState } from "react";
import { useProblemConfig } from "../components/problem-config";

// JSON からテキスト候補を拾うヘルパ
function pickTextFromJson(json: any): string | null {
  const candidates = [
    json?.description,
    json?.problem?.text,
    json?.problemText,
    json?.text,
    json?.statement,
  ];
  const found = candidates.find(
    (v) => typeof v === "string" && v.trim().length > 0
  );
  return found ? String(found) : null;
}

export default function HomePage() {
  const {
    classProblemText,
    objectProblemText,
    classAnswerPuml,
    objectAnswerPuml,
    setClassProblemText,
    setObjectProblemText,
    setClassAnswerPuml,
    setObjectAnswerPuml,
    resetAll,
  } = useProblemConfig();

  const [error, setError] = useState<string | null>(null);

  async function handleProblemUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "class" | "object"
  ) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const text = await file.text();

    try {
      let body: string;
      if (name.endsWith(".json")) {
        const json = JSON.parse(text);
        const picked = pickTextFromJson(json);
        if (!picked)
          throw new Error("JSON内に問題文テキストが見つかりませんでした。");
        body = picked.trim();
      } else if (name.endsWith(".txt")) {
        body = text.trim();
      } else {
        throw new Error("問題文は .json / .txt を指定してください。");
      }

      if (kind === "class") setClassProblemText(body);
      else setObjectProblemText(body);
    } catch (err: any) {
      setError(err?.message ?? "問題文ファイルの読込に失敗しました。");
    } finally {
      e.target.value = "";
    }
  }

  async function handlePumlUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "class" | "object"
  ) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const text = (await file.text()).trim();
    if (!text) {
      setError("PlantUMLファイルが空です。");
      return;
    }
    if (kind === "class") setClassAnswerPuml(text);
    else setObjectAnswerPuml(text);
    e.target.value = "";
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold mb-2">
        教員用設定ページ（問題文・正答例の登録）
      </h1>
      <p className="text-sm text-neutral-700">
        ここで登録した内容は、学習用ページから参照されます。
        ローカル環境ではブラウザの <code>localStorage</code> に保存されます。
      </p>

      {error && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* クラス図作成問題文 */}
      <section className="rounded-lg border p-4 bg-white space-y-2">
        <h2 className="font-semibold">クラス図作成問題（本文）</h2>
        <input
          type="file"
          accept=".json,.txt"
          onChange={(e) => handleProblemUpload(e, "class")}
          className="text-sm"
        />
        <div className="mt-2 text-xs">
          <div className="font-semibold mb-1">現在の内容プレビュー</div>
          {/* ← 高さ上限 + 中だけスクロール */}
          <div className="border rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap bg-neutral-50">
            {classProblemText || "（未登録）"}
          </div>
        </div>
      </section>

      {/* オブジェクト図作成問題文 */}
      <section className="rounded-lg border p-4 bg-white space-y-2">
        <h2 className="font-semibold">オブジェクト図作成問題（本文）</h2>
        <input
          type="file"
          accept=".json,.txt"
          onChange={(e) => handleProblemUpload(e, "object")}
          className="text-sm"
        />
        <div className="mt-2 text-xs">
          <div className="font-semibold mb-1">現在の内容プレビュー</div>
          <div className="border rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap bg-neutral-50">
            {objectProblemText || "（未登録）"}
          </div>
        </div>
      </section>

      {/* 正答例 PlantUML */}
      <section className="rounded-lg border p-4 bg-white space-y-3">
        <h2 className="font-semibold">正答例 PlantUML</h2>

        <div className="space-y-1">
          <div className="text-sm font-medium">
            クラス図（正答例）PlantUML をアップロード
          </div>
          <input
            type="file"
            accept=".puml,.txt"
            onChange={(e) => handlePumlUpload(e, "class")}
            className="text-sm"
          />
          <div className="text-xs mt-1">
            <div className="font-semibold">現在の内容</div>
            <pre className="border rounded p-2 max-h-40 overflow-y-auto bg-neutral-50 text-[10px] whitespace-pre-wrap">
              {classAnswerPuml || "（未登録）"}
            </pre>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">
            オブジェクト図（正答例）PlantUML をアップロード
          </div>
          <input
            type="file"
            accept=".puml,.txt"
            onChange={(e) => handlePumlUpload(e, "object")}
            className="text-sm"
          />
          <div className="text-xs mt-1">
            <div className="font-semibold">現在の内容</div>
            <pre className="border rounded p-2 max-h-40 overflow-y-auto bg-neutral-50 text-[10px] whitespace-pre-wrap">
              {objectAnswerPuml || "（未登録）"}
            </pre>
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetAll}
          className="px-3 py-1 rounded border text-sm"
        >
          すべてリセット
        </button>
        <span className="text-xs text-neutral-500">
          ※ブラウザのローカル保存も消去されます。
        </span>
      </div>
    </div>
  );
}
