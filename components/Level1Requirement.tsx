// components/Level1Requirement.tsx
"use client";

import { useMemo } from "react";
// ★ lib がプロジェクト直下なら "@/lib/..."。相対なら "../lib/..." に直す
import { parseLevel1, Ann } from "@/lib/level1-parse";

type Props = {
  text: string;
  onPickObject: (o: { instance: string; className?: string }) => void;
  onPickSlot:   (s: { key: string; value: string; ofInstance: string }) => void;
  onPickRel?:   (r: { from: string; to: string; label?: string }) => void;
};

export default function Level1Requirement({ text, onPickObject, onPickSlot, onPickRel }: Props) {
  const { tokens } = useMemo(() => parseLevel1(text), [text]);

  // ★ デバッグ: 何個の token が取れているかを上に表示（slot=0ならパーサが原因）
  const counts = useMemo(() => {
    let t = 0, o = 0, s = 0, r = 0;
    for (const k of tokens) {
      if (k.type === "text") t++;
      else if (k.type === "obj") o++;
      else if (k.type === "slot") s++;
      else if (k.type === "rel") r++;
    }
    // eslint-disable-next-line no-console
    console.log("[Level1Requirement] tokens:", tokens);
    return { t, o, s, r };
  }, [tokens]);

  return (
    <div className="text-[15px] leading-7">
      <div className="flex items-center gap-2 text-xs text-neutral-600">
        <Legend />
        <span className="ml-2">/ obj:{counts.o} slot:{counts.s} rel:{counts.r}</span>
      </div>

      <div className="mt-2">
        {tokens.map((tk, i) => {
          if (tk.type === "text") return <span key={i}>{tk.value}</span>;

          if (tk.type === "obj") {
            const a = tk.ann as Ann & { kind: "obj" };
            const instance = a.instance?.trim();
            const label = a.className ? `${instance} : ${a.className}` : instance;
            if (!instance) return <span key={i}></span>;
            return (
              <button
                key={i}
                type="button"
                className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-blue-50 border border-blue-300 text-blue-950 hover:bg-blue-100"
                onClick={(e)=>{e.preventDefault(); onPickObject({ instance, className: a.className?.trim() || undefined });}}
                title="クリックでオブジェクトに追加"
              >
                <span className="mr-1">◇</span><span>{label}</span>
              </button>
            );
          }

          if (tk.type === "slot") {
            const a = tk.ann as Ann & { kind: "slot" };
            const key = a.key?.trim(); const ofInst = a.ofInstance?.trim(); const value = (a.value ?? "").trim();
            const disabled = !key || !ofInst;
            return (
              <button
                key={i}
                type="button"
                className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded border ${disabled ? "bg-orange-50/60 border-orange-200 text-orange-400 cursor-not-allowed" : "bg-orange-50 border-orange-300 text-orange-950 hover:bg-orange-100"}`}
                onClick={(e)=>{e.preventDefault(); if (disabled) return; onPickSlot({ key: key!, value, ofInstance: ofInst! });}}
                title={disabled ? "key と of が必要です" : "クリックでスロットに追加"}
              >
                <span className="mr-1">▣</span><span>{key ?? "?"}={value}</span>{ofInst ? <span className="ml-1 opacity-70">（of {ofInst}）</span> : null}
              </button>
            );
          }

          const a = tk.ann as Ann & { kind: "rel" };
          const from = a.from?.trim(); const to = a.to?.trim(); const label = a.label?.trim();
          const disabled = !from || !to;
          return (
            <button
              key={i}
              type="button"
              className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded border ${disabled ? "bg-green-50/60 border-green-200 text-green-400 cursor-not-allowed" : "bg-green-50 border-green-300 text-green-950 hover:bg-green-100"}`}
              onClick={(e)=>{e.preventDefault(); if (disabled || !onPickRel) return; onPickRel({ from: from!, to: to!, label });}}
              title={disabled ? "from/to が必要です" : "クリックでリンクに追加"}
            >
              <span className="mr-1">⇄</span><span>{from ?? "?"} → {to ?? "?"}</span>{label ? <span className="ml-1 opacity-70">（{label}）</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center px-1 py-0.5 rounded bg-blue-50  border border-blue-300  text-blue-950 text-xs">◇ オブジェクト</span>
      <span className="inline-flex items-center px-1 py-0.5 rounded bg-orange-50 border border-orange-300 text-orange-950 text-xs">▣ スロット</span>
      <span className="inline-flex items-center px-1 py-0.5 rounded bg-green-50 border border-green-300 text-green-950 text-xs">⇄ リンク</span>
    </div>
  );
}
