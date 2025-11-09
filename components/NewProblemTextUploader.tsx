"use client";
import { useState } from "react";

type Props = {
  /** アップロードされた本文を親コンポーネントに通知するコールバック */
  onTextChange?: (text: string) => void;
};

export default function ProblemTextUploader({ onTextChange }: Props) {
  const [uploadedText, setUploadedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // ファイルサイズ制限（2MB）
    const MAX = 2 * 1024 * 1024;
    if (file.size > MAX) {
      setError("ファイルが大きすぎます（2MBまで）。");
      return;
    }

    const name = file.name.toLowerCase();
    const text = await file.text();

    try {
      if (name.endsWith(".json")) {
        const json = JSON.parse(text);
        const picked = pickProblemTextFromJson(json);
        if (!picked) throw new Error("JSON内に問題文が見つかりませんでした。");
        setUploadedText(picked.trim());
        onTextChange?.(picked.trim());
      } else if (name.endsWith(".txt")) {
        setUploadedText(text.trim());
        onTextChange?.(text.trim());
      } else {
        throw new Error("対応拡張子は .json / .txt です。");
      }
    } catch (err: any) {
      setError(err?.message ?? "ファイルの解析に失敗しました。");
      setUploadedText(null);
      onTextChange?.("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".json,.txt"
          onChange={handleFile}
          className="block"
        />
        {uploadedText && (
          <button
            type="button"
            onClick={() => {
              setUploadedText(null);
              onTextChange?.("");
            }}
            className="px-3 py-1 rounded border"
            aria-label="アップロード内容をクリア"
          >
            取り消し
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* アップロードされた問題文の表示 */}
      {uploadedText ? (
        <div className="text-sm leading-7 whitespace-pre-wrap">
          {uploadedText}
        </div>
      ) : (
        <div className="text-sm text-neutral-500">
          問題文ファイル（.txt または .json）をアップロードしてください。
        </div>
      )}
    </div>
  );
}

function pickProblemTextFromJson(json: any): string | null {
  const candidates = [
    json?.text,
    json?.content,
    json?.description,
    json?.problem?.text,
    json?.problemText,
    json?.statement,
  ];
  return candidates.find(v => typeof v === "string" && v.trim().length > 0) ?? null;
}