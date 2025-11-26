"use client";

import { Link as LinkType, Obj } from "@/types";
import { useState } from "react";

export function LinkMiniAdder({
  objects,
  links,
  setLinks,
}: {
  objects: Obj[];
  links: LinkType[];
  setLinks: (next: LinkType[]) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const objectNames = objects.map((o) => o.name).filter((n) => n && n.length > 0);

  const resetForm = () => {
    setFrom("");
    setTo("");
    setLabel("");
    setEditingIndex(null);
  };

  const handleAddOrUpdate = () => {
    if (!from || !to) {
      alert("「～は」「～を」の両方にオブジェクトを選んでください。");
      return;
    }
    const trimmedLabel = label.trim();

    if (editingIndex === null) {
      // 追加
      setLinks([
        ...links,
        {
          from,
          to,
          label: trimmedLabel || undefined,
        },
      ]);
    } else {
      // 更新
      const next = [...links];
      next[editingIndex] = {
        ...next[editingIndex],
        from,
        to,
        label: trimmedLabel || undefined,
      };
      setLinks(next);
    }
    resetForm();
  };

  const handleEdit = (idx: number) => {
    const l = links[idx];
    setFrom(l.from);
    setTo(l.to);
    setLabel(l.label ?? "");
    setEditingIndex(idx);
  };

  const handleDelete = (idx: number) => {
    if (!confirm("この関係を削除してよいですか？")) return;
    const next = [...links];
    next.splice(idx, 1);
    setLinks(next);
    // 編集中のものを消した場合はフォームもリセット
    if (editingIndex === idx) {
      resetForm();
    }
  };

  const previewSentence = () => {
    const f = from || "□";
    const t = to || "△";
    const lbl = label.trim() || "〜する";
    return `${f} は、${t} を ${lbl}`;
  };

  return (
    <div className="space-y-2">
      {/* 入力フォーム */}
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="whitespace-nowrap">□ は</span>
          <select
            className="border rounded px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">（オブジェクトを選択）</option>
            {objectNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <span className="whitespace-nowrap">、 △ を</span>
          <select
            className="border rounded px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">（オブジェクトを選択）</option>
            {objectNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <span className="whitespace-nowrap">〜する（関係ラベル）:</span>
          <input
            className="border rounded px-2 py-1 flex-1 min-w-[120px]"
            placeholder="例: 注文する / 所属する など（空なら「〜する」）"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {/* プレビュー文 */}
        <div className="text-[11px] text-neutral-600">
          プレビュー：<span className="font-mono">{previewSentence()}</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1 rounded border text-xs"
            onClick={handleAddOrUpdate}
          >
            {editingIndex === null ? "関係を追加" : "関係を更新"}
          </button>
          {editingIndex !== null && (
            <button
              type="button"
              className="px-3 py-1 rounded border text-xs"
              onClick={resetForm}
            >
              編集キャンセル
            </button>
          )}
        </div>
      </div>

      {/* 追加済みリンクの一覧（編集・削除付き） */}
      <ul className="text-xs mt-2 space-y-1">
        {links.map((l, i) => {
          const sentence = `${l.from} は、${l.to} を ${
            l.label?.trim() || "〜する"
          }`;
          return (
            <li
              key={i}
              className="flex items-center justify-between gap-2 border rounded px-2 py-1 bg-neutral-50"
            >
              <span className="flex-1">{sentence}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="px-2 py-0.5 rounded border text-[10px]"
                  onClick={() => handleEdit(i)}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded border text-[10px]"
                  onClick={() => handleDelete(i)}
                >
                  削除
                </button>
              </div>
            </li>
          );
        })}
        {links.length === 0 && (
          <li className="text-[11px] text-neutral-400 list-none">
            まだ関係は追加されていません。
          </li>
        )}
      </ul>
    </div>
  );
}
