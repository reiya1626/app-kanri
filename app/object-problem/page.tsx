// app/object-problem/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

// 既に追加済みのコンポーネント/パーサを使います
// パスはあなたの構成に合わせて相対に変更してください
import Level1Requirement from "../../components/Level1Requirement";
import { Problems } from "../problems";

// ---- 型 ----
type Attr = { key: string; value: string };
type Obj  = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string; mult?: string };

// === ページ本体 ===
export default function ObjectProblemPage() {
  // 課題テキスト（固定でOK：本番を選ぶ）
  const problem = useMemo(
    () => Problems.find(p => p.id === "case_estate_real_01") ?? Problems[0],
    []
  );

  // 既存フォームと共有する snapshot
  const [snapshot, setSnapshot] = useState<{ objects: Obj[]; links: Link[] }>({
    objects: [],
    links: [],
  });

  // 右側のPlantUMLプレビューURL
  const [pumlUrl, setPumlUrl] = useState<string>("");

  // ---- クリックUI→snapshot 反映（既存フォームと“共用”）----
  function addObject(o: { instance: string; className?: string }) {
    const name = (o.instance ?? "").trim();
    const className = o.className?.trim();
    if (!name) return;

    setSnapshot(prev =>
      prev.objects.some(x => x.name === name)
        ? prev
        : { ...prev, objects: [...prev.objects, { name, type: className, attrs: [] }] }
    );
  }

  function addSlot(s: { key: string; value: string; ofInstance: string }) {
    const key = (s.key ?? "").trim();
    const value = (s.value ?? "").trim();
    const ofInstance = (s.ofInstance ?? "").trim();
    if (!key || !ofInstance) return;

    setSnapshot(prev => {
      const objs = [...prev.objects];
      let i = objs.findIndex(o => o.name === ofInstance);
      if (i < 0) {
        objs.push({ name: ofInstance, attrs: [] });
        i = objs.length - 1;
      }
      const tgt = { ...objs[i] };
      const attrs = [...(tgt.attrs ?? [])];

      // ★同じキーは上書き（「押したのに変わらない」を防ぐ）
      const k = attrs.findIndex(a => a.key === key);
      if (k >= 0) attrs[k] = { key, value };
      else attrs.push({ key, value });

      tgt.attrs = attrs; objs[i] = tgt;
      return { ...prev, objects: objs };
    });
  }

  function addLink(r: { from: string; to: string; label?: string }) {
    const from = (r.from ?? "").trim();
    const to   = (r.to   ?? "").trim();
    const label = r.label?.trim() || undefined;
    if (!from || !to) return;

    setSnapshot(prev => {
      if (prev.links.some(l => l.from === from && l.to === to && (l.label ?? "") === (label ?? ""))) return prev;
      return { ...prev, links: [...prev.links, { from, to, label }] };
    });
  }

  // ---- プレビュー更新（/api/object-puml）----
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/object-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const json = await res.json();
        setPumlUrl(json?.urlSvg || "");
      } catch {
        setPumlUrl("");
      }
    }, 250);
    return () => clearTimeout(id);
  }, [snapshot]);

  // ===== レイアウト =====
  return (
    <div className="max-w-6xl mx-auto grid grid-cols-3 gap-4 p-4">
      {/* 左カラム：色分けテキスト + 既存フォーム + デバッグ */}
      <div className="col-span-2 space-y-4">

        {/* 1) 色分けテキスト（クリックで snapshot に追加） */}
        <div>
          <h1 className="text-xl font-semibold mb-2">
            レベル1：要求文の色分けからオブジェクト図を作る
          </h1>
          <Level1Requirement
            text={problem.text}
            onPickObject={addObject}
            onPickSlot={addSlot}
            onPickRel={addLink}
          />
        </div>

        {/* 2) ここに “あなたの既存フォーム” をそのまま貼る */}
        <div className="rounded-lg border p-4">
          {/* ▼▼▼▼▼▼▼▼▼▼▼▼ 既存フォームの JSX をこの中にペースト ▼▼▼▼▼▼▼▼▼▼▼▼ */}
          {/* 
            例：
              - オブジェクト名入力、属性追加ボタン、オブジェクト追加ボタン…の既存UI
              - 既存フォームが snapshot を自前で持っていた場合は、
                「今ここで持っている snapshot/state を使う」ように置換してください。
                （例：setSnapshot を使う・既存の setObjects/setLinks を snapshot へ統合）
          */}
          {/* ▲▲▲▲▲▲▲▲▲▲▲▲ 既存フォームの JSX をこの中にペースト ▲▲▲▲▲▲▲▲▲▲▲▲ */}
        </div>

        {/* 3) デバッグ表示（必要なければ削除OK） */}
        <div>
          <h3 className="font-semibold text-sm mb-1">現在のスナップショット（デバッグ表示）</h3>
          <pre className="text-xs bg-neutral-50 p-2 border rounded h-48 overflow-auto">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </div>
      </div>

      {/* 右カラム：PlantUMLプレビュー */}
      <div className="col-span-1 space-y-2">
        <h2 className="font-semibold">プレビュー</h2>
        {pumlUrl ? (
          <iframe src={pumlUrl} className="w-full h-[520px] border rounded" />
        ) : (
          <div className="text-sm text-neutral-500 border rounded p-3">
            青（オブジェクト）・橙（スロット）・緑（リンク）をクリックすると図が表示されます。
          </div>
        )}
      </div>
    </div>
  );
}
