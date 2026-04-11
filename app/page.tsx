// app/page.tsx
// 教員用の設定ページ
"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useProblemConfig } from "@/components/config/problem-config";
import type { ProblemData } from "@/types/problem";

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

function validateProblemInput(params: {
  title: string;
  objectProblemText: string;
  objectAnswerPuml: string;
}) {
  const errors: string[] = [];

  if (!params.title.trim()) {
    errors.push("タイトルが空です。");
  }

  if (!params.objectProblemText.trim()) {
    errors.push("オブジェクト図作成問題（本文）が空です。");
  }

  if (!params.objectAnswerPuml.trim()) {
    errors.push("オブジェクト図の正答例 PlantUML が空です。");
  }

  if (
    params.objectAnswerPuml.trim() &&
    !params.objectAnswerPuml.includes("@startuml")
  ) {
    errors.push("正答例 PlantUML に @startuml がありません。");
  }

  if (
    params.objectAnswerPuml.trim() &&
    !params.objectAnswerPuml.includes("@enduml")
  ) {
    errors.push("正答例 PlantUML に @enduml がありません。");
  }

  return errors;
}

function buildProblemData(params: {
  title: string;
  objectProblemText: string;
  objectAnswerPuml: string;
  classProblemText: string;
  classAnswerPuml: string;
}): ProblemData {
  return {
    id: "current",
    title: params.title.trim() || "無題",
    objectProblemText: params.objectProblemText.trim(),
    objectAnswerPuml: params.objectAnswerPuml.trim(),
    classProblemText: params.classProblemText.trim() || undefined,
    classAnswerPuml: params.classAnswerPuml.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
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

  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedProblem, setSavedProblem] = useState<ProblemData | null>(null);

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
        if (!picked) {
          throw new Error("JSON内に問題文テキストが見つかりませんでした。");
        }
        body = picked.trim();
      } else if (name.endsWith(".txt")) {
        body = text.trim();
      } else {
        throw new Error("問題文は .json / .txt を指定してください。");
      }

      if (kind === "class") {
        setClassProblemText(body);
      } else {
        setObjectProblemText(body);
      }
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

    try {
      const text = (await file.text()).trim();
      if (!text) {
        throw new Error("PlantUMLファイルが空です。");
      }

      if (kind === "class") {
        setClassAnswerPuml(text);
      } else {
        setObjectAnswerPuml(text);
      }
    } catch (err: any) {
      setError(err?.message ?? "PlantUMLファイルの読込に失敗しました。");
    } finally {
      e.target.value = "";
    }
  }

  function handleSave() {
    setError(null);

    const validationErrors = validateProblemInput({
      title,
      objectProblemText,
      objectAnswerPuml,
    });

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setSavedProblem(null);
      return;
    }

    const problem = buildProblemData({
      title,
      objectProblemText,
      objectAnswerPuml,
      classProblemText,
      classAnswerPuml,
    });

    // 既存の useProblemConfig 保存を活かしつつ、
    // Step 2 で決めた「問題1件」の形も localStorage に残す
    localStorage.setItem(
      "od-app/current-problem/v1",
      JSON.stringify({
        currentProblem: problem,
      })
    );

    setErrors([]);
    setSavedProblem(problem);
  }

  function handleReset() {
    resetAll();
    setTitle("");
    setError(null);
    setErrors([]);
    setSavedProblem(null);
    localStorage.removeItem("od-app/current-problem/v1");
  }

  const status = useMemo(() => {
    const hasTitle = title.trim().length > 0;
    const hasObjectProblemText = objectProblemText.trim().length > 0;
    const hasObjectAnswerPuml = objectAnswerPuml.trim().length > 0;
    const isReadyForLearning = [
      hasTitle,
      hasObjectProblemText,
      hasObjectAnswerPuml,
    ].every(Boolean);

    return {
      hasTitle,
      hasObjectProblemText,
      hasObjectAnswerPuml,
      isReadyForLearning,
    };
  }, [title, objectProblemText, objectAnswerPuml]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold mb-2">
        教員用設定ページ（問題文・正答例の登録）
      </h1>

      <p className="text-sm text-neutral-700">
        ここで登録した内容は、学習用ページから参照されます。
        ローカル環境ではブラウザの <code>localStorage</code> に保存されます。
      </p>

      {(error || errors.length > 0) && (
        <div className="text-sm text-red-700 border border-red-300 bg-red-50 px-3 py-3 rounded space-y-2">
          {error && <div>{error}</div>}
          {errors.length > 0 && (
            <div>
              <div className="font-semibold mb-1">保存できませんでした。</div>
              <ul className="list-disc pl-5 space-y-1">
                {errors.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {savedProblem && (
        <div className="text-sm text-green-700 border border-green-300 bg-green-50 px-3 py-3 rounded space-y-1">
          <div className="font-semibold">保存しました。</div>
          <div>タイトル: {savedProblem.title}</div>
          <div>更新日時: {savedProblem.updatedAt}</div>
        </div>
      )}

      <section className="rounded-lg border p-4 bg-white space-y-2">
        <h2 className="font-semibold">問題タイトル</h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 図書館システムの貸出管理"
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <div className="text-xs text-neutral-500">
          学習環境へ渡す問題の識別用タイトルです。
        </div>
      </section>

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
          <div className="border rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap bg-neutral-50">
            {classProblemText || "（未登録）"}
          </div>
        </div>
      </section>

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

      <section className="rounded-lg border p-4 bg-white space-y-3">
        <h2 className="font-semibold">正答例 PlantUML</h2>

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
      </section>

      <section className="rounded-lg border p-4 bg-neutral-50 space-y-2">
        <h2 className="font-semibold">登録状態</h2>
        <div className="text-sm space-y-1">
          <div>タイトル: {status.hasTitle ? "登録済み" : "未登録"}</div>
          <div>
            オブジェクト図作成問題:{" "}
            {status.hasObjectProblemText ? "登録済み" : "未登録"}
          </div>
          <div>
            オブジェクト図正答例:{" "}
            {status.hasObjectAnswerPuml ? "登録済み" : "未登録"}
          </div>
          <div>
            学習環境利用可: {status.isReadyForLearning ? "OK" : "NG"}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded border text-sm bg-black text-white"
        >
          保存する
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-2 rounded border text-sm"
        >
          すべてリセット
        </button>

        {status.isReadyForLearning ? (
          <Link
            href="/main"
            className="px-4 py-2 rounded border text-sm bg-white hover:bg-neutral-50"
          >
            学習画面へ進む
          </Link>
        ) : (
          <span className="text-xs text-neutral-500">
            タイトル・オブジェクト図問題・オブジェクト図正答例を登録すると学習画面へ進めます。
          </span>
        )}
      </div>

      <div className="text-xs text-neutral-500">
        ※「すべてリセット」は既存の problem-config 保存内容と、
        <code className="mx-1">od-app/current-problem/v1</code>
        を削除します。
      </div>
    </div>
  );
}