"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  WizardState, ClassPumlResponse, WizardClassAttr, WizardRelation
} from "@/types";

type Target =
  | { kind: "node"; className: string }
  | { kind: "edge"; from: string; to: string };

// SVGの <a> を action:* で探しやすくする補助
const selFor = (t: Target) =>
  t.kind === "node"
    ? `a[xlink\\:href="action:node:${cssEsc(t.className)}"], a[href="action:node:${cssEsc(t.className)}"]`
    : `a[xlink\\:href="action:edge:${cssEsc(t.from)}--${cssEsc(t.to)}"], a[href="action:edge:${cssEsc(t.from)}--${cssEsc(t.to)}"]`;

// CSSエスケープ（ごく簡易）
function cssEsc(s: string) {
  return s.replace(/"/g, '\\"');
}

export default function ClassWorkbench({
  wizard,
  onWizardChange,
}: {
  wizard: WizardState;
  onWizardChange: (w: WizardState) => void;
}) {
  const [svg, setSvg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  // 追加：ズーム
  const [zoom, setZoom] = useState(1); // 1.0 = 100%
  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null); // transform用ラッパ

  // --- 図の再生成（interactive + draft） ---
  async function reload() {
    setErr(null); setLoading(true);
    try {
      const r = await fetch("/api/class-puml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wizard, interactive: true, draft: true, showLegend: true }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as (ClassPumlResponse & { puml?: string; svg?: string });
      let text = j.svg;
      if (!text && j.urlSvg) {
        // フォールバック取得
        const rr = await fetch(j.urlSvg, { cache: "no-store" });
        if (!rr.ok) throw new Error(`SVG取得に失敗: HTTP ${rr.status}`);
        text = await rr.text();
      }
      if (!text) throw new Error("SVGが取得できませんでした。");
      setSvg(text);
      // 再描画時はハイライトをクリア
      setTimeout(() => {
        injectStyleOnce();
        if (target) highlightTarget(target, true);
      }, 0);
    } catch (e: any) {
      setErr(e?.message ?? "クラス図の生成に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  // 初回＆wizard変更で再描画（軽いデバウンス）
  useEffect(() => {
    const t = setTimeout(() => reload(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(wizard)]);

  // --- SVG内のリンク(action:...)を捕捉してターゲット更新 ---
  useEffect(() => {
    const el = svgHostRef.current;
    if (!el) return;
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("xlink:href") || a.getAttribute("href");
      if (!href || !href.startsWith("action:")) return;
      ev.preventDefault();
      const [, kind, payload] = href.split(":");
      if (kind === "node") {
        const t: Target = { kind: "node", className: payload };
        setTarget(t);
        highlightTarget(t, true);
      } else if (kind === "edge") {
        const [from, to] = payload.split("--");
        if (from && to) {
          const t: Target = { kind: "edge", from, to };
          setTarget(t);
          highlightTarget(t, true);
        }
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [svg, target]);

  // ===== ハイライト注入 & スクロール =====
  function injectStyleOnce() {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    if (svgEl.querySelector("style[data-injected='1']")) return;

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("data-injected", "1");
    style.textContent = `
a[data-selected="true"] path,
a[data-selected="true"] polygon,
a[data-selected="true"] polyline,
a[data-selected="true"] rect,
a[data-selected="true"] ellipse,
a[data-selected="true"] line {
  stroke: #2563eb !important; /* 青 */
  stroke-width: 2.5 !important;
}
a[data-selected="true"] text {
  fill: #1d4ed8 !important;
  font-weight: 700;
}
    `.trim();
    svgEl.appendChild(style);
  }

  function clearHighlight() {
    const host = svgHostRef.current;
    if (!host) return;
    host.querySelectorAll('a[data-selected="true"]').forEach(a => {
      a.removeAttribute("data-selected");
    });
  }

  function highlightTarget(t: Target, scrollIntoView: boolean) {
    injectStyleOnce();
    clearHighlight();
    const host = svgHostRef.current;
    if (!host) return;
    const sel = selFor(t);
    const a = host.querySelector(sel) as SVGAElement | null;
    if (!a) return;
    a.setAttribute("data-selected", "true");
    // クリック対象を最前面へ（視覚的な重なり対策）
    a.parentElement?.appendChild(a);

    if (scrollIntoView) {
      // ブロック位置へスクロール（スムーズ）
      (a as any).scrollIntoView
        ? (a as any).scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
        : centerScrollTo(a);
    }
  }

  // scrollIntoViewが効かない場合のフォールバック
  function centerScrollTo(el: Element) {
    const wrap = containerRef.current;
    if (!wrap) return;
    const r = (el as HTMLElement).getBoundingClientRect();
    const rw = wrap.getBoundingClientRect();
    const dx = (r.left + r.right) / 2 - (rw.left + rw.right) / 2;
    const dy = (r.top + r.bottom) / 2 - (rw.top + rw.bottom) / 2;
    wrap.scrollBy({ left: dx, top: dy, behavior: "smooth" });
  }

  // ===== 右パネル：エディタ =====
  function NodeEditor({ t }: { t: Extract<Target, { kind: "node" }> }) {
    const klass = wizard.classes.find(c => c.className === t.className);
    const attrs = (wizard.classAttrs ?? []).filter(a => a.className === t.className);
    if (!klass) return <div className="text-xs text-muted-foreground">クラスが見つかりません。</div>;

    const rename = (newName: string) => {
      if (!newName?.trim()) return;
      onWizardChange({
        ...wizard,
        classes: wizard.classes.map(c =>
          c.className === t.className ? { ...c, className: newName } : c
        ),
        classAttrs: (wizard.classAttrs ?? []).map(a =>
          a.className === t.className ? { ...a, className: newName } : a
        ),
        relations: wizard.relations.map(r => ({
          ...r,
          from: r.from === t.className ? newName : r.from,
          to:   r.to   === t.className ? newName : r.to,
        })),
        inheritances: (wizard.inheritances ?? []).map(i => ({
          ...i,
          parent: i.parent === t.className ? newName : i.parent,
          child:  i.child  === t.className ? newName : i.child,
        })),
      });
      const nt: Target = { kind: "node", className: newName };
      setTarget(nt);
      setTimeout(() => highlightTarget(nt, false), 0);
    };

    const toggleEnabled = () => {
      onWizardChange({
        ...wizard,
        classes: wizard.classes.map(c =>
          c.className === t.className ? { ...c, enabled: !c.enabled } : c
        ),
      });
    };

    const addAttr = () => {
      const base = prompt("属性名を入力（例：所在地）");
      if (!base) return;
      onWizardChange({
        ...wizard,
        classAttrs: [
          ...(wizard.classAttrs ?? []),
          { className: t.className, name: base, type: "unknown", required: false, isId: false },
        ],
      });
    };

    const setAttr = (name: string, patch: Partial<WizardClassAttr>) => {
      onWizardChange({
        ...wizard,
        classAttrs: (wizard.classAttrs ?? []).map(a =>
          a.className === t.className && a.name === name ? { ...a, ...patch } : a
        ),
      });
    };

    const delAttr = (name: string) => {
      onWizardChange({
        ...wizard,
        classAttrs: (wizard.classAttrs ?? []).filter(a =>
          !(a.className === t.className && a.name === name)
        ),
      });
    };

    return (
      <div className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground">クラス</div>
        <input
          className="border rounded px-2 py-1 w-full"
          value={klass.className}
          onChange={(e) => rename(e.target.value)}
        />
        <Button variant="secondary" onClick={toggleEnabled}>
          {klass.enabled ? "このクラスを一時無効にする" : "このクラスを有効にする"}
        </Button>

        <div className="pt-2">
          <div className="text-xs uppercase text-muted-foreground mb-1">属性</div>
          {attrs.length === 0 && (
            <div className="text-xs text-muted-foreground">（属性なし）</div>
          )}
          {attrs.map(a => (
            <div key={a.name} className="flex items-center gap-2 mb-1">
              <input
                className="border rounded px-2 py-1"
                value={a.name}
                onChange={(e) => setAttr(a.name, { name: e.target.value })}
              />
              <select
                className="border rounded px-2 py-1"
                value={a.type}
                onChange={(e) => setAttr(a.name, { type: e.target.value as any })}
              >
                <option value="unknown">unknown</option>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={a.required}
                  onChange={(e) => setAttr(a.name, { required: e.target.checked })}
                />
                必須
              </label>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={a.isId}
                  onChange={(e) => setAttr(a.name, { isId: e.target.checked })}
                />
                ID
              </label>
              <Button variant="secondary" onClick={() => delAttr(a.name)}>削除</Button>
            </div>
          ))}
          <Button onClick={addAttr}>+ 属性を追加</Button>
        </div>
      </div>
    );
  }

  function EdgeEditor({ t }: { t: Extract<Target, { kind: "edge" }> }) {
    const rel = wizard.relations.find(r => r.from === t.from && r.to === t.to);
    if (!rel) return <div className="text-xs text-muted-foreground">関連が見つかりません。</div>;

    const patch = (p: Partial<WizardRelation>) => {
      onWizardChange({
        ...wizard,
        relations: wizard.relations.map(r =>
          r.from === t.from && r.to === t.to ? { ...r, ...p } : r
        ),
      });
      setTimeout(() => highlightTarget(t, false), 0);
    };

    // 軽いヒント（未入力なら候補を強調）
    const hintFromEmpty = !rel.multFrom;
    const hintToEmpty   = !rel.multTo;

    return (
      <div className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground">関連</div>
        <div className="text-sm">{t.from} — {t.to}</div>

        <label className="text-xs">ラベル</label>
        <input
          className="border rounded px-2 py-1 w-full"
          value={rel.label ?? ""}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder="例: 帰属 / 所有 / 属する など"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs">from役割名</label>
            <input
              className="border rounded px-2 py-1 w-full"
              value={rel.roleFrom ?? ""}
              onChange={(e) => patch({ roleFrom: e.target.value })}
              placeholder="例: 所有者, 親 など"
            />
          </div>
          <div>
            <label className="text-xs">to役割名</label>
            <input
              className="border rounded px-2 py-1 w-full"
              value={rel.roleTo ?? ""}
              onChange={(e) => patch({ roleTo: e.target.value })}
              placeholder="例: 所有物, 子 など"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs">from多重度 {hintFromEmpty && <span className="text-[10px] text-orange-600">(未設定)</span>}</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={rel.multFrom ?? ""}
              onChange={(e) => patch({ multFrom: e.target.value })}
            >
              <option value=""></option>
              <option value="1">1</option>
              <option value="0..1">0..1</option>
              <option value="1..*">1..*</option>
              <option value="0..*">0..*</option>
            </select>
          </div>
          <div>
            <label className="text-xs">to多重度 {hintToEmpty && <span className="text-[10px] text-orange-600">(未設定)</span>}</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={rel.multTo ?? ""}
              onChange={(e) => patch({ multTo: e.target.value })}
            >
              <option value=""></option>
              <option value="1">1</option>
              <option value="0..1">0..1</option>
              <option value="1..*">1..*</option>
              <option value="0..*">0..*</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => patch({ enabled: !rel.enabled })}>
            {rel.enabled ? "この関連を一時無効にする" : "この関連を有効にする"}
          </Button>
        </div>
      </div>
    );
  }

  // ====== ズームUI ======
  const ZoomBar = () => (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}>−</Button>
      <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
      <Button type="button" variant="outline" onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}>＋</Button>
      <Button type="button" variant="secondary" onClick={() => setZoom(1)}>フィット</Button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 図面（埋め込みSVG + ズーム） */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>暫定クラス図（クリックして編集）</CardTitle>
          <ZoomBar />
        </CardHeader>
        <CardContent>
          {loading && <div className="h-6 w-40 animate-pulse rounded bg-muted" />}
          {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
          <div
            ref={containerRef}
            className="w-full overflow-auto border rounded bg-white"
            style={{ maxHeight: 600 }}
          >
            <div
              ref={svgHostRef}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
                width: "fit-content",
              }}
              // 埋め込み：SVGテキスト
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 右：編集パネル */}
      <Card>
        <CardHeader>
          <CardTitle>プロパティ編集</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!target && (
            <div className="text-xs text-muted-foreground">
              図のクラス/関連をクリックするとここに編集が出ます。
            </div>
          )}
          {target?.kind === "node" && <NodeEditor t={target} />}
          {target?.kind === "edge" && <EdgeEditor t={target} />}
          <div className="pt-2 flex gap-2">
            <Button variant="secondary" onClick={() => { setTarget(null); clearHighlight(); }}>
              閉じる
            </Button>
            <Button onClick={reload}>再描画</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
