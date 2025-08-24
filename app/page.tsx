// app/level1/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/** =========================
 * 型
 * ========================= */
type Attr = { key: string; value: string };
type Obj = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

/** =========================
 * ページ
 * ========================= */
export default function Level1Page() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ objects: [], links: [] });
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [objErr, setObjErr] = useState("");
  const isEmptySnapshot = (s: Snapshot) =>
  (!s.objects || s.objects.length === 0) && (!s.links || s.links.length === 0);
  const [clsPumlUrl, setClsPumlUrl] = useState("");
  const [clsErr, setClsErr] = useState("");
  const [autoClass, setAutoClass] = useState(true); // 自動変換トグル


  // PlantUML（オブジェクト図）
  useEffect(() => {
    if (isEmptySnapshot(snapshot)) {
      setObjPumlUrl("");
      setObjErr("");
      return;
    }
    const id = setTimeout(async () => {
      try {
        setObjErr("");
        const res = await fetch("/api/object-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setObjErr(j?.error || `HTTP ${res.status}`);
          setObjPumlUrl("");
        } else {
          setObjPumlUrl(j?.urlSvg || "");
        }
      } catch (e: any) {
        setObjErr(e?.message || "fetch error");
        setObjPumlUrl("");
      }
    }, 250);
    return () => clearTimeout(id);
  }, [snapshot]);
 
  // クラス図（推定） — snapshot が埋まってきたら自動で変換
  useEffect(() => {
    if (!autoClass) return;
    const hasEnough = (snapshot.objects?.length ?? 0) >= 1; // 必要条件はお好みで
    if (!hasEnough) {
      setClsPumlUrl("");
      setClsErr("");
      return;
    }
    const id = setTimeout(async () => {
      try {
        setClsErr("");
        const res = await fetch("/api/class-puml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setClsErr(j?.error || `HTTP ${res.status}`);
          setClsPumlUrl("");
        } else {
          setClsPumlUrl(j?.urlSvg || "");
        }
      } catch (e: any) {
        setClsErr(e?.message || "fetch error");
        setClsPumlUrl("");
      }
    }, 350);
    return () => clearTimeout(id);
  }, [snapshot, autoClass]);

  return (
    <div className="p-6 space-y-4">
      {/* 問題文 */}
      <section className="rounded-lg border bg-white">
        <div className="p-5 border-b font-semibold">クラス図作成問題（本文）</div>
        <div className="p-5 text-sm leading-7">
          次の文章の内容を表現する概念モデル（クラス図）を作成してください。<br />
          物件にはマンション物件と戸建て物件の2種類がある。物件は所在地と販売価格を持ち、
          マンション物件は部屋番号を持つ。マンション物件はその物件の棟に帰属する。
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：入力・ガイド */}
        <section className="rounded-lg border bg-white">
          <div className="p-5 border-b font-semibold">状況①：まずは，オブジェクト図から作ってみよう！</div>
          <div className="p-5 text-sm leading-7">
         長野市松代町東条 1-2-3 にあるマンションでは、5階の 502号室（販売価格 2,980 万円）と、<br />
         12階の 1203号室（販売価格 4,150 万円）が売り出し中であり、どちらも棟Aに帰属している。<br />
         建物の棟の名称は「棟A」である。
        </div>
          <div className="p-5 space-y-4">
            {/* ▶ ガイドモード（新規） */}
            <GuidedMode snapshot={snapshot} setSnapshot={setSnapshot} />

            {/* 既存の補助 UI */}
            <QuickAdd snapshot={snapshot} setSnapshot={setSnapshot} />
            <ManualObjectsForm snapshot={snapshot} setSnapshot={setSnapshot} />
            <LinkMiniAdder snapshot={snapshot} setSnapshot={setSnapshot} />

            {/* デバッグ */}
            <div className="text-xs text-neutral-600">
              <div className="font-semibold mb-1">現在のスナップショット（デバッグ表示）</div>
              <pre className="rounded border bg-neutral-50 p-3 overflow-auto">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </div>
          </div>
        </section>

        {/* 右：プレビュー */}
        {/* 右：プレビュー */}
{/* 右：プレビュー */}
<section className="rounded-lg border bg-white">
  <div className="p-5 border-b flex items-center justify-between">
    <div className="font-semibold">（入力中のプレビュー）オブジェクト図</div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="text-sm px-3 py-1 rounded border"
        onClick={() => {
          if (!isEmptySnapshot(snapshot) && !confirm("プレビューをクリアします。よろしいですか？")) return;
          setSnapshot({ objects: [], links: [] });
          setObjPumlUrl("");
          setObjErr("");
          setClsPumlUrl("");
          setClsErr("");
        }}
      >
        プレビューをクリア
      </button>
    </div>
  </div>

  <div className="p-5">
    {/* オブジェクト図 SVG */}
    {objErr && <div className="text-xs text-red-600 mb-2">API error: {objErr}</div>}
    {objPumlUrl ? (
      <img alt="object-uml" src={objPumlUrl} />
    ) : (
      <div className="text-xs text-neutral-500">PlantUML</div>
    )}
  </div>
</section>

{/* クラス図（推定） */}
<section className="rounded-lg border bg-white mt-4">
  <div className="p-5 border-b flex items-center justify-between">
    <div className="font-semibold">クラス図（推定）</div>
    <div className="flex items-center gap-3">
      <label className="text-xs flex items-center gap-1">
        <input type="checkbox" checked={autoClass} onChange={(e)=>setAutoClass(e.target.checked)} />
        自動変換
      </label>
      <button
        type="button"
        className="text-sm px-2 py-1 rounded border"
        onClick={async () => {
          try {
            setClsErr("");
            const res = await fetch("/api/class-puml", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ snapshot }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
              setClsErr(j?.error || `HTTP ${res.status}`);
              setClsPumlUrl("");
            } else {
              setClsPumlUrl(j?.urlSvg || "");
            }
          } catch (e: any) {
            setClsErr(e?.message || "fetch error");
            setClsPumlUrl("");
          }
        }}
      >
        今すぐ変換
      </button>
    </div>
  </div>

  <div className="p-5">
    {clsErr && <div className="text-xs text-red-600 mb-2">API error: {clsErr}</div>}
    {clsPumlUrl ? (
      <img alt="class-uml" src={clsPumlUrl} />
    ) : (
      <div className="text-xs text-neutral-500">オブジェクト図ができると、ここにクラス図の推定結果が表示されます。</div>
    )}
  </div>
</section>


      </div>
    </div>
  );
}

/** =========================
 * ガイドモード
 *  - オブジェクトを選ぶ → 「このオブジェクトが持つべき情報はどれ？」（複数）
 *  - 採点 → 正答だけを snapshot に追加
 * ========================= */
type QuizItem =
  | { id: string; kind: "slot"; label: string; correct: boolean; payload: { of: string; key: string; value: string } }
  | { id: string; kind: "link"; label: string; correct: boolean; payload: { from: string; to: string; label?: string } };

// 教師データ（この問題に合わせた正解セット）
const GOLD: Record<
  string,
  { slots: { key: string; value: string }[]; links: { to: string; label?: string }[] }
> = {
  "マンション物件1": {
    slots: [
      { key: "所在地", value: "長野市松代町東条1-2-3" },
      { key: "販売価格", value: "2980万円" },
      { key: "部屋番号", value: "502号室" },
    ],
    links: [{ to: "棟A", label: "帰属" }],
  },
  "マンション物件2": {
    slots: [
      { key: "所在地", value: "長野市松代町東条1-2-3" },
      { key: "販売価格", value: "4150万円" },
      { key: "部屋番号", value: "1203号室" },
    ],
    links: [{ to: "棟A", label: "帰属" }],
  },
  "棟A": { slots: [], links: [] },
};

function GuidedMode({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const [enabled, setEnabled] = useState(true);
  const [target, setTarget] = useState<string>("");
  const [choices, setChoices] = useState<QuizItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [judged, setJudged] = useState(false);

  // ターゲット変更時に問題を生成
  useEffect(() => {
    if (!target) return;
    setChoices(generateQuizFor(target, snapshot));
    setSelected({});
    setJudged(false);
  }, [target, snapshot]);

  const score = useMemo(() => {
    if (!judged) return null as null | { ok: number; ng: number; total: number };
    let ok = 0,
      ng = 0,
      total = 0;
    for (const c of choices) {
      const sel = !!selected[c.id];
      if (c.correct && sel) ok++;
      else if (!c.correct && sel) ng++;
      if (c.correct) total++;
    }
    return { ok, ng, total };
  }, [judged, choices, selected]);

  const addCorrectToSnapshot = () => {
    if (!judged) return;
    setSnapshot((prev) => {
      let cur = { ...prev };
      for (const c of choices) {
        if (!c.correct) continue;
        if (c.kind === "slot") {
          cur = upsertAttr(cur, c.payload.of, c.payload.key, c.payload.value);
        } else {
          const { from, to, label } = c.payload;
          if (!cur.links.some((l) => l.from === from && l.to === to && (l.label ?? "") === (label ?? ""))) {
            cur = { ...cur, links: [...cur.links, { from, to, label }] };
          }
        }
      }
      // 選んだオブジェクト自体が未作成なら追加
      if (!cur.objects.some((o) => o.name === target)) {
        cur = { ...cur, objects: [...cur.objects, { name: target, attrs: [] }] };
      }
      // リンク先・of が未作成なら追加
      const others = new Set<string>();
      for (const c of choices) {
        if (!c.correct) continue;
        if (c.kind === "slot") others.add(c.payload.of);
        if (c.kind === "link") others.add(c.payload.to);
      }
      for (const name of others) {
        if (!cur.objects.some((o) => o.name === name)) cur = { ...cur, objects: [...cur.objects, { name, attrs: [] }] };
      }
      return cur;
    });
  };

  return (
    <div className="rounded border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">レベル１(オブジェクト図を描くのも危うい人向け)</div>
        <label className="text-xs flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          有効にする
        </label>
      </div>

      {enabled && (
        <>
          {/* 1. 対象オブジェクトの選択 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm">オブジェクトを選んでね：</span>
            <select className="border rounded px-2 py-1" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="" disabled>
                選択してね
              </option>
              {["マンション物件1", "マンション物件2", "棟A"].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {target && <span className="text-sm opacity-70">→ 「{target}」ってどんな情報(販売価格とか所在地のことだよ)を持ってる？（複数選択）</span>}
          </div>

          {/* 2. 選択肢（スロットとリンクを分離表示） */}
{target && (
  <div className="rounded border p-2 space-y-3">
    <div className="text-xs opacity-80">本文から判断して選んでください。</div>

    {(() => {
      const slotChoices = choices.filter((c) => c.kind === "slot");
      const linkChoices = choices.filter((c) => c.kind === "link");

      return (
        <>
          {/* スロット */}
          <div>
            <div className="text-xs font-semibold mb-1 text-teal-700">スロット</div>
            {slotChoices.length === 0 ? (
              <div className="text-xs text-neutral-500">候補はありません。</div>
            ) : (
              <div className="space-y-1">
                {slotChoices.map((c) => {
                  const sel = !!selected[c.id];
                  const isOk = judged && sel && c.correct;
                  const isNg = judged && sel && !c.correct;
                  return (
                    <label
                      key={c.id}
                      className={
                        "flex items-center gap-2 text-sm px-2 py-1 rounded " +
                        (isOk ? "bg-green-50" : isNg ? "bg-red-50" : "bg-neutral-50")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
                      />
                      <span>{c.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* リンク */}
          <div className="pt-2 border-t">
            <div className="text-xs font-semibold mb-1 text-indigo-700">リンク</div>
            {linkChoices.length === 0 ? (
              <div className="text-xs text-neutral-500">候補はありません。</div>
            ) : (
              <div className="space-y-1">
                {linkChoices.map((c) => {
                  const sel = !!selected[c.id];
                  const isOk = judged && sel && c.correct;
                  const isNg = judged && sel && !c.correct;
                  return (
                    <label
                      key={c.id}
                      className={
                        "flex items-center gap-2 text-sm px-2 py-1 rounded " +
                        (isOk ? "bg-green-50" : isNg ? "bg-red-50" : "bg-neutral-50")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
                      />
                      <span>{c.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </>
      );
    })()}
    {/* 3. 採点＆反映 */}
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        className="px-3 py-1 rounded border"
        onClick={() => setJudged(true)}
      >
        採点
      </button>

      {judged && score && (
        <>
          <span className="text-sm">
            正解 {score.ok} / {score.total}　
            {score.ng ? `（誤選択 ${score.ng}）` : ""}
          </span>
          <button
            type="button"
            className="px-3 py-1 rounded bg-black text-white"
            onClick={addCorrectToSnapshot}
          >
            正答を反映
          </button>
        </>
      )}

      {!judged && (
        <>
          {/* スロット用ヒント */}
          <button
            type="button"
            className="px-3 py-1 rounded border"
            onClick={() => {
              const one = choices.find((c) => c.kind === "slot" && c.correct && !selected[c.id]);
              if (one) setSelected((s) => ({ ...s, [one.id]: true }));
            }}
          >
            ヒント（スロット）
          </button>
          {/* リンク用ヒント */}
          <button
            type="button"
            className="px-3 py-1 rounded border"
            onClick={() => {
              const one = choices.find((c) => c.kind === "link" && c.correct && !selected[c.id]);
              if (one) setSelected((s) => ({ ...s, [one.id]: true }));
            }}
          >
            ヒント（リンク）
          </button>
        </>
      )}
    </div>
  </div>
)}
        </>
      )}
    </div>
  );
}

function generateQuizFor(target: string, snap: Snapshot): QuizItem[] {
  const gold = GOLD[target] ?? { slots: [], links: [] };
  const others = Object.keys(GOLD).filter((k) => k !== target);

  // ← これがないと ts(2304) になります
  const items: QuizItem[] = [];

  // --- 正答スロット（ターゲット対象） ---
  gold.slots.forEach((s, i) =>
    items.push({
      id: `SOK-${i}`,
      kind: "slot",
      correct: true,
      label: `${s.key} = "${s.value}"`,
      payload: { of: target, key: s.key, value: s.value },
    })
  );

  // ターゲット正答の重複除外用セット
  const correctSet = new Set(gold.slots.map((s) => `${s.key}::${s.value}`));

  // --- ダミースロット（他オブジェクトの属性）---
  //     ターゲットの正答と (key,value) が同じものは除外
  others.forEach((o) => {
    (GOLD[o].slots ?? []).forEach((s, i) => {
      const sig = `${s.key}::${s.value}`;
      if (correctSet.has(sig)) return;
      items.push({
        id: `SNG-${o}-${i}`,
        kind: "slot",
        correct: false,
        label: `${s.key} = "${s.value}"`,
        payload: { of: target, key: s.key, value: s.value },
      });
    });
  });

  // --- リンク（関連）---
  // ターゲットのリンクだけ正解。その他は誤りとして出す（表示は同じ）
  Object.entries(GOLD).forEach(([fromName, spec]) => {
    (spec.links ?? []).forEach((l, i) => {
      const isCorrect = fromName === target;
      items.push({
        id: `LOK-${fromName}-${i}`,
        kind: "link",
        correct: isCorrect,
        label: `${fromName} → ${l.to}`,
        payload: { from: fromName, to: l.to, label: l.label },
      });
    });
  });

  // 並び替え＆返却
  shuffle(items);
  return items; // 件数制限するなら .slice(0, 10)
}

// 配列シャッフル
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


/** =========================
 * 既存：かんたん追加
 * ========================= */
function QuickAdd({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const addObject = (name: string, type?: string) =>
    setSnapshot((prev) =>
      prev.objects.some((o) => o.name === name)
        ? prev
        : { ...prev, objects: [...prev.objects, { name, type, attrs: [] }] }
    );

  const addAttr = (of: string, key: string, value: string) =>
    setSnapshot((prev) => upsertAttr(prev, of, key, value));

  const addLink = (from: string, to: string, label?: string) =>
    setSnapshot((prev) =>
      prev.links.some(
        (l) => l.from === from && l.to === to && (l.label ?? "") === (label ?? "")
      )
        ? prev
        : { ...prev, links: [...prev.links, { from, to, label }] }
    );

  return (
    <div className="rounded border p-3 space-y-2">
      <div className="text-sm font-semibold">レベル2（ちょっと自分で考えたい人向け）</div>

      <div className="text-xs opacity-70">オブジェクト</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addObject("マンション物件1", "物件")}>マンション物件1 </Chip>
        <Chip onClick={() => addObject("マンション物件2", "物件")}>マンション物件2 </Chip>
        <Chip onClick={() => addObject("棟A", "棟")}>棟A</Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">スロット</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addAttr("マンション物件1", "所在地", "長野市松代町東条1-2-3")}>
          所在地="長野市松代町東条1-2-3"
        </Chip>
        <Chip onClick={() => addAttr("マンション物件1", "販売価格", "2980万円")}>
          販売価格="2980万円"
        </Chip>
        <Chip onClick={() => addAttr("マンション物件1", "部屋番号", "502号室")}>
          部屋番号="502号室"
        </Chip>
        <Chip onClick={() => addAttr("マンション物件2", "販売価格", "4150万円")}>
          販売価格="4150万円"
        </Chip>
        <Chip onClick={() => addAttr("マンション物件2", "部屋番号", "1203号室")}>
          部屋番号="1203号室"
        </Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">リンク</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addLink("マンション物件1", "棟A", "帰属")}>マンション物件1 → 棟A（帰属）</Chip>
        <Chip onClick={() => addLink("マンション物件2", "棟A", "帰属")}>マンション物件2 → 棟A（帰属）</Chip>
      </div>
    </div>
  );
}



/** =========================
 * 既存：手入力フォーム
 * ========================= */
function ManualObjectsForm({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const addObject = () =>
    setSnapshot((prev) => ({ ...prev, objects: [...prev.objects, { name: "", attrs: [] }] }));

  const updateName = (idx: number, name: string) =>
    setSnapshot((prev) => {
      const objs = [...prev.objects];
      objs[idx] = { ...objs[idx], name };
      return { ...prev, objects: objs };
    });

  const addAttrTo = (idx: number) =>
    setSnapshot((prev) => {
      const objs = [...prev.objects];
      const t = { ...(objs[idx] ?? { attrs: [] }) };
      t.attrs = [...(t.attrs ?? []), { key: "", value: "" }];
      objs[idx] = t;
      return { ...prev, objects: objs };
    });

  const updateAttr = (idx: number, aidx: number, patch: Partial<Attr>) =>
    setSnapshot((prev) => {
      const objs = [...prev.objects];
      const o = { ...objs[idx], attrs: [...(objs[idx].attrs ?? [])] };
      o.attrs[aidx] = { ...o.attrs[aidx], ...patch };
      objs[idx] = o;
      return { ...prev, objects: objs };
    });

  const removeObject = (idx: number) =>
    setSnapshot((prev) => {
      const name = prev.objects[idx]?.name;
      const objects = prev.objects.filter((_, i) => i !== idx);
      const links = prev.links.filter((l) => l.from !== name && l.to !== name);
      return { objects, links };
    });

  return (
    <div className="rounded border p-3">
      <div className="text-sm font-semibold mb-2">レベル3(自力でオブジェクトを完成させたい人向け)</div>

      <div className="space-y-3">
        {snapshot.objects.map((o, idx) => (
          <div key={idx} className="rounded border p-3">
            <div className="flex items-center gap-2">
              <div className="text-xs w-16 text-neutral-500">オブジェクト名</div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="例: マンション物件M1"
                value={o.name}
                onChange={(e) => updateName(idx, e.target.value)}
              />
              <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => removeObject(idx)}>
                オブジェクト削除
              </button>
            </div>

            <div className="mt-2">
              <div className="text-xs text-neutral-500 mb-1">スロット</div>
              <div className="space-y-2">
                {(o.attrs ?? []).map((a, aidx) => (
                  <div key={aidx} className="flex items-center gap-2">
                    <input
                      className="border rounded px-2 py-1 w-40"
                      placeholder="key（例：販売価格）"
                      value={a.key}
                      onChange={(e) => updateAttr(idx, aidx, { key: e.target.value })}
                    />
                    <input
                      className="border rounded px-2 py-1 w-60"
                      placeholder='value（例："2980万円"）'
                      value={a.value}
                      onChange={(e) => updateAttr(idx, aidx, { value: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <button type="button" className="mt-2 text-xs px-2 py-1 rounded border" onClick={() => addAttrTo(idx)}>
                ＋ 属性を追加
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <button type="button" className="px-3 py-1 rounded bg-black text-white" onClick={addObject}>
          ＋ オブジェクトを追加
        </button>
      </div>
    </div>
  );
}

function LinkMiniAdder({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const names = snapshot.objects.map((o) => o.name);
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(names[0] ?? "");
  const [to, setTo] = React.useState(names[1] ?? "");
  const [label, setLabel] = React.useState("帰属");
  const [msg, setMsg] = React.useState<string | null>(null);

  // オブジェクトの増減に追随
  React.useEffect(() => {
    if (!names.includes(from)) setFrom(names[0] ?? "");
    if (!names.includes(to)) setTo(names.find((n) => n !== from) ?? names[0] ?? "");
  }, [names.join("|")]); // eslint-disable-line

  const add = () => {
    setMsg(null);
    if (!from || !to) {
      setMsg("from/to を選択してください");
      return;
    }
    if (from === to) {
      setMsg("from と to が同じです");
      return;
    }
    setSnapshot((prev) => {
      const exists = prev.links.some(
        (l) => l.from === from && l.to === to && (l.label ?? "") === (label ?? "")
      );
      if (exists) {
        setMsg("同じリンクがすでにあります");
        return prev;
      }
      setMsg("追加しました");
      return { ...prev, links: [...prev.links, { from, to, label }] };
    });
    // 1秒後に自動で閉じる
    setTimeout(() => setOpen(false), 800);
  };

  if (names.length < 2) {
    // オブジェクトが足りないときはボタンは表示しつつ、押したら警告
    return (
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="px-3 py-1 rounded border text-sm"
          onClick={() => setMsg("リンクを作るには、最低2つのオブジェクトが必要です")}
        >
          ＋ リンクを追加
        </button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="px-3 py-1 rounded border text-sm"
          onClick={() => setOpen((v) => !v)}
        >
          ＋ リンクを追加
        </button>
        {msg && <span className="text-xs text-green-700">{msg}</span>}
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="border rounded px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-sm">→</span>
          <select className="border rounded px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input
            className="border rounded px-2 py-1 w-28"
            placeholder="ラベル（例：帰属）"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="button" className="px-3 py-1 rounded bg-black text-white" onClick={add}>
            追加
          </button>
          <button type="button" className="px-3 py-1 rounded border" onClick={() => setOpen(false)}>
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
}

/** =========================
 * 小物：Chip / スナップショット操作
 * ========================= */
function Chip(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={
        "text-sm px-2 py-1 rounded-full border bg-neutral-50 hover:bg-neutral-100 " + (className ?? "")
      }
    />
  );
}

function upsertAttr(prev: Snapshot, of: string, key: string, value: string): Snapshot {
  const i = prev.objects.findIndex((o) => o.name === of);
  const objs = [...prev.objects];
  if (i < 0) {
    objs.push({ name: of, attrs: [{ key, value }] });
  } else {
    const o = { ...objs[i], attrs: [...(objs[i].attrs ?? [])] };
    const k = o.attrs.findIndex((a) => a.key === key);
    if (k >= 0) o.attrs[k] = { key, value };
    else o.attrs.push({ key, value });
    objs[i] = o;
  }
  return { ...prev, objects: objs };
}
