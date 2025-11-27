// components/LinkMiniAdder.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Obj, Link } from "@/types";

type Props = {
  objects: Obj[];
  links: Link[];
  setLinks: (links: Link[]) => void;
};

export function LinkMiniAdder({ objects, links, setLinks }: Props) {
  const objectNames = useMemo(
    () => objects.map((o) => o.name).filter((n) => n),
    [objects]
  );

  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    links.length ? 0 : null
  );

  // links の増減に応じて選択インデックスを調整
  useEffect(() => {
    if (links.length === 0) {
      setSelectedIndex(null);
    } else if (selectedIndex === null || selectedIndex >= links.length) {
      setSelectedIndex(0);
    }
  }, [links.length, selectedIndex]);

  const addLink = () => {
    const next = [...links, { from: "", to: "", label: "" }];
    setLinks(next);
    setSelectedIndex(next.length - 1);
  };

  const removeLink = (idx: number) => {
    const next = [...links];
    next.splice(idx, 1);
    setLinks(next);

    setSelectedIndex((prev) => {
      if (next.length === 0) return null;
      if (prev === null) return 0;
      if (idx === prev) return Math.min(prev, next.length - 1);
      if (idx < prev) return prev - 1;
      return prev;
    });
  };

  const updateSelected = (patch: Partial<Link>) => {
    if (selectedIndex === null) return;
    const next = [...links];
    const current = next[selectedIndex] ?? { from: "", to: "", label: "" };
    next[selectedIndex] = { ...current, ...patch };
    setLinks(next);
  };

  const selectedLink =
    selectedIndex !== null ? links[selectedIndex] ?? null : null;

  const previewSentence =
    selectedLink && (selectedLink.from || selectedLink.to)
      ? `${selectedLink.from || "（未選択）"} は、${
          selectedLink.to || "（未選択）"
        } を ${selectedLink.label?.trim() || "〜する"}`
      : "オブジェクトを選ぶと、ここに「□ は △ を ～する」の文が表示されます。";

  return (
    <div className="space-y-3 text-xs">
      {/* 上：リンク一覧 */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold">登録済みリンク一覧</div>
        <button
          type="button"
          className="text-xs px-3 py-1 rounded border bg-neutral-50 hover:bg-neutral-100"
          onClick={addLink}
        >
          ＋ リンクを追加
        </button>
      </div>

      <div className="border rounded bg-neutral-50 max-h-40 overflow-y-auto">
        {links.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-neutral-500">
            まだリンクがありません。「＋ リンクを追加」から作成してください。
          </div>
        ) : (
          <ul className="divide-y">
            {links.map((l, idx) => {
              const isSelected = idx === selectedIndex;
              const labelText = l.label?.trim() || "〜する";
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
                    <span className="font-mono text-[11px]">
                      {l.from || "（未選択）"} は、{l.to || "（未選択）"} を{" "}
                      {labelText}
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
                        removeLink(idx);
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

      {/* 下：編集パネル（選択中 or 新規） */}
      {selectedLink ? (
        <div className="border rounded p-3 space-y-2 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold">
              編集中のリンク：{selectedIndex! + 1} 行目
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="border rounded px-2 py-1 text-xs bg-white"
              value={selectedLink.from}
              onChange={(e) => updateSelected({ from: e.target.value })}
            >
              <option value="">（□ は …）</option>
              {objectNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <span className="text-xs">は、</span>

            <select
              className="border rounded px-2 py-1 text-xs bg-white"
              value={selectedLink.to}
              onChange={(e) => updateSelected({ to: e.target.value })}
            >
              <option value="">（△ を …）</option>
              {objectNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <span className="text-xs">を</span>

            <input
              className="border rounded px-2 py-1 text-xs bg-white flex-1 min-w-[120px]"
              placeholder="例: 履修する, 所属する（空なら「〜する」）"
              value={selectedLink.label ?? ""}
              onChange={(e) => updateSelected({ label: e.target.value })}
            />
          </div>

          <div className="text-[11px] text-neutral-600">
            プレビュー：<span className="font-mono">{previewSentence}</span>
          </div>

          <div className="text-[10px] text-neutral-500">
            ※ 「□ は △ を ～する」の形でオブジェクト間の関係を表します。
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-neutral-500">
          ※ 編集したいリンクを一覧から選択するか、「＋ リンクを追加」で新しく作成してください。
        </div>
      )}
    </div>
  );
}
