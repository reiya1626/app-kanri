"use client";

import { useState } from "react";

export default function AuthorUploadPage() {
  const [classProblemText, setClassProblemText] = useState<string>("");
  const [objectProblemText, setObjectProblemText] = useState<string>("");
  const [busy, setBusy] = useState(false); // ← これがないと「busy is not defined」になる
  const [autoGenLoading, setAutoGenLoading] = useState(false);

  // ファイル選択 → 本文読込 → オブジェクト図問題文をAPIで自動生成
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setClassProblemText(text);

    const res = await fetch("/api/generate-object-problem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classProblemText: text,
        constraints: {
          objectCount: { min: 3, max: 7 },
          numericRanges: { price: { min: 1000, max: 5000000 }, roomNo: { min: 101, max: 1205 } },
          properNounStyle: "日本人名",
          domainHints: ["会員", "貸出記録", "書籍", "部屋番号"],
          seed: 42
        }
      }),
    });
    const data = await res.json();
    setObjectProblemText(data.objectProblemText || "");
    // もし裏で候補UIを出したいなら data.plan.objects / links を保持

  }

  // 下書き保存 or 公開
  async function saveScenario(status: "draft" | "published") {
    setBusy(true);
    try {
      const res = await fetch("/api/upload-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classProblemText,
          objectProblemText,
          status,
        }),
      });
      const { id } = await res.json(); // { id: "scenario-..." }

      // 公開なら学生画面へ、下書きなら一覧へ
      if (status === "published") {
        location.href = `/attempt/${id}`;
      } else {
        location.href = `/author/scenarios`;
      }
    } catch (err) {
      console.error("save failed:", err);
      alert("保存に失敗しました。コンソールを確認してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">課題文をアップロード</h1>
      <p className="text-sm text-gray-600">
        クラス図作成問題の本文ファイルを選んでください。この文章から、学習者向けの
        「ステップ1（オブジェクト図作成問題）」と「ステップ2（クラス図作成問題）」を用意します。
      </p>

      {/* 1) ファイル入力 */}
      <div className="border rounded-lg p-4">
        <p className="mb-2 text-sm">1. 問題文ファイルを選択してください</p>
        <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer">
          <input type="file" className="hidden" onChange={handleFile} />
          ここをクリックしてファイルを選択
        </label>
        {autoGenLoading && (
          <p className="text-xs text-gray-500 mt-2">ステップ1の問題文を自動生成しています…</p>
        )}
      </div>

      {/* 2) ステップ1：オブジェクト図作成問題（自動生成・編集可） */}
      <div className="border rounded-lg p-4">
        <p className="mb-2 text-sm">2. ステップ1：オブジェクト図を作るための問題文（編集できます）</p>
        <textarea
          className="w-full h-40 border rounded p-2 text-sm"
          value={objectProblemText}
          onChange={(e) => setObjectProblemText(e.target.value)}
          placeholder="自動生成された問題文がここに入ります"
        />
      </div>

      {/* 3) ステップ2：クラス図作成問題（元の本文） */}
      <div className="border rounded-lg p-4">
        <p className="mb-2 text-sm">3. ステップ2：クラス図作成問題（元の本文・編集できます）</p>
        <textarea
          className="w-full h-40 border rounded p-2 text-sm"
          value={classProblemText}
          onChange={(e) => setClassProblemText(e.target.value)}
          placeholder="アップロードした本文がここに入ります"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          className="px-3 py-2 border rounded"
          onClick={() => saveScenario("draft")}
          disabled={busy}
        >
          {busy ? "保存中…" : "下書き保存"}
        </button>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={() => saveScenario("published")}
          disabled={busy || !classProblemText.trim()}
        >
          {busy ? "公開中…" : "この課題を演習として公開"}
        </button>
      </div>
    </main>
  );
}
