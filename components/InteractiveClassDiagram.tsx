// components/InteractiveClassDiagram.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export default function InteractiveClassDiagram({
  urlSvg,
  puml,
  onClickClass,
  onClickRelation,
}: {
  urlSvg?: string | null;
  puml?: string | null;
  onClickClass: (className: string) => void;
  onClickRelation: (from: string, to: string) => void;
}) {
  const [svgText, setSvgText] = useState<string>("");
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!urlSvg) { setSvgText(""); return; }
    (async () => {
      const res = await fetch(urlSvg);
      const text = await res.text();
      setSvgText(text);
    })();
  }, [urlSvg]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;

      // <a xlink:href="#cls/xxx"> or "#rel/A--B"
      const a = target.closest("a") as HTMLAnchorElement | null;
      const href = a?.getAttribute("xlink:href") || a?.getAttribute("href");
      if (!href || !href.startsWith("#")) return;

      const hash = href.slice(1); // "cls/マンション物件" or "rel/マンション物件--棟"
      if (hash.startsWith("cls/")) {
        const name = decodeURIComponent(hash.slice(4));
        onClickClass(name);
      } else if (hash.startsWith("rel/")) {
        const pair = hash.slice(4);
        const [from, to] = pair.split("--").map(decodeURIComponent);
        if (from && to) onClickRelation(from, to);
      }
      ev.preventDefault();
    };

    host.addEventListener("click", handler);
    return () => host.removeEventListener("click", handler);
  }, [hostRef, onClickClass, onClickRelation]);

  if (!urlSvg) return <div className="text-sm text-muted-foreground">クラス図未生成</div>;

  return (
    <div className="border rounded bg-white p-2 overflow-auto min-h-[360px]" ref={hostRef}>
      {/* SVG をそのまま埋め込む（イベント拾える） */}
      {svgText ? (
        <div dangerouslySetInnerHTML={{ __html: svgText }} />
      ) : (
        <div className="text-xs text-muted-foreground">読み込み中…</div>
      )}
      {/* デバッグ用：PUMLを見たい時 */}
      {/* <details className="mt-2 text-xs"><summary>PlantUML</summary><pre>{puml}</pre></details> */}
    </div>
  );
}
