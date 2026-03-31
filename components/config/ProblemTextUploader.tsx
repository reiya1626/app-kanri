// components/ProblemTextUploader.tsx
"use client";
import { useRef, useState } from "react";

type Props = {
  /** 初期表示の本文 */
  defaultText: string;
  /** 親へ通知したい場合（任意） */
  onChangeText?: (text: string) => void;
};

function pickProblemTextFromJson(json: any): string | null {
  const candidates = [
    json?.description,
    json?.problem?.text,
    json?.problemText,
    json?.text,
    json?.statement,
    json?.body,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return found ? String(found) : null;
}

export default function ProblemTextUploader({ defaultText, onChangeText }: Props) {
  const [uploadedText, setUploadedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const problemText = uploadedText ?? defaultText;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX) {
      setError("ファイルが大きすぎます（2MBまで）。");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const name = file.name.toLowerCase();
    const raw = await file.text();
    const text = raw.replace(/\r\n?/g, "\n"); // 改行統一

    try {
      if (name.endsWith(".json")) {
        const json = JSON.parse(text);
        const picked = pickProblemTextFromJson(json);
        if (!picked) throw new Error("JSON内に問題文テキストが見つかりませんでした。");
        setUploadedText(picked.trim());
        onChangeText?.(picked.trim());
      } else if (name.endsWith(".txt")) {
        setUploadedText(text.trim());
        onChangeText?.(text.trim());
      } else {
        throw new Error("対応拡張子は .json / .txt です。");
      }
    } catch (err: any) {
      setError(err?.message ?? "ファイルの解析に失敗しました。");
      setUploadedText(null);
      onChangeText?.(defaultText);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearUpload() {
    setUploadedText(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
    onChangeText?.(defaultText);
  }

  return (
    <div className="space-y-3">
      {/* アップロードUI */}
      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt"
          onChange={handleFile}
          className="block"
        />
        <button
          type="button"
          onClick={clearUpload}
          className="px-3 py-1 rounded border"
          aria-label="アップロード内容をクリア"
        >
          取り消し
        </button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* 本文表示（テキストとして安全に表示） */}
      <pre className="whitespace-pre-wrap break-words">{problemText}</pre>
    </div>
  );
}
