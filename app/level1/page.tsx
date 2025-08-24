// app/level1/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/** 型 */
type Attr = { key: string; value: string };
type Obj = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

/** ページ本体 */
export default function Page() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ objects: [], links: [] });
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [objErr, setObjErr] = useState("");

  // プレビュー更新
  useEffect(() => {
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

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：入力 */}
        <section className="rounded-lg border bg-white">
          <div className="p-5 border-b font-semibold">状況①：まずは，オブジェクト図から作ってみよう！</div>
          <div className="p-5 space-y-4">
            <QuickAdd snapshot={snapshot} setSnapshot={setSnapshot} />
            <AttributeMiniForm snapshot={snapshot} setSnapshot={setSnapshot} />
            <RelationWizard snapshot={snapshot} setSnapshot={setSnapshot} />
            <ManualObjectsForm snapshot={snapshot} setSnapshot={setSnapshot} />

            {/* ★ 追加：リンク手入力フォーム（オブジェクトの下） */}
            <ManualLinksForm snapshot={snapshot} setSnapshot={setSnapshot} />

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
        <section className="rounded-lg border bg-white">
          <div className="p-5 border-b font-semibold">（入力中のプレビュー）</div>
          <div className="p-5 space-y-2">
            <div className="text-xs text-neutral-500">入力内容を自動でプレビューするよ！</div>

            <div className="rounded border bg-white">
              <div className="px-4 py-2 text-sm font-semibold border-b">オブジェクト図</div>
              <div className="p-3">
                {objErr && <div className="text-xs text-red-600 mb-2">API error: {objErr}</div>}
                {objPumlUrl ? (
                  <iframe key={objPumlUrl} src={objPumlUrl} className="w-full h-[340px] rounded border" />
                ) : (
                  <div className="text-sm text-neutral-500 border rounded p-4">
                    左でオブジェクト／属性／リンクを追加すると、ここに図が表示されます。
                  </div>
                )}
              </div>
            </div>

            <div className="text-xs text-neutral-500 mt-1">PlantUML</div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** かんたん追加（おすすめ） */
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
      <div className="text-sm font-semibold">レベル1（オブジェクト図自体の色もない人向け）</div>

      <div className="text-xs opacity-70">オブジェクト</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addObject("マンション物件1", "物件")}>マンション物件1</Chip>
        <Chip onClick={() => addObject("マンション物件2", "物件")}>マンション物件2</Chip>
        <Chip onClick={() => addObject("棟A", "棟")}>棟A</Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">スロット</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addAttr("マンション物件1", "所在地", "長野市松代町東条1-2-3")}>所在地（物件1）</Chip>
        <Chip onClick={() => addAttr("マンション物件1", "販売価格", "2980万円")}>販売価格=2980万円（物件1）</Chip>
        <Chip onClick={() => addAttr("マンション物件1", "部屋番号", "502号室")}>部屋番号=502号室（物件1）</Chip>
        <Chip onClick={() => addAttr("マンション物件2", "販売価格", "4150万円")}>販売価格=4150万円（物件2）</Chip>
        <Chip onClick={() => addAttr("マンション物件2", "部屋番号", "1203号室")}>部屋番号=1203号室（物件2）</Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">リンク</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addLink("マンション物件1", "棟A", "帰属")}>物件1→棟A（帰属）</Chip>
        <Chip onClick={() => addLink("マンション物件2", "棟A", "帰属")}>物件2→棟A（帰属）</Chip>
      </div>
    </div>
  );
}

/** 属性ミニフォーム */
function AttributeMiniForm({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const keys = ["所在地", "販売価格", "部屋番号", "階"];
  const [of, setOf] = useState("");
  const [key, setKey] = useState(keys[0]);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!of && snapshot.objects.length > 0) setOf(snapshot.objects[0].name);
  }, [snapshot.objects.length, of]);

  const add = () => {
    if (!of || !key) return;
    setSnapshot((prev) => upsertAttr(prev, of, key, value));
    setValue("");
  };

  return (
    <div className="rounded border p-3">
      <div className="text-sm font-semibold mb-2">属性を追加（フォーム）</div>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="border rounded px-2 py-1" value={of} onChange={(e) => setOf(e.target.value)}>
          {snapshot.objects.map((o) => (
            <option key={o.name} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
        <select className="border rounded px-2 py-1" value={key} onChange={(e) => setKey(e.target.value)}>
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          className="border rounded px-2 py-1 w-56"
          placeholder="値（例：2980万円）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="px-3 py-1 rounded bg-black text-white" onClick={add}>
          追加
        </button>
      </div>
    </div>
  );
}

/** 関係の一括作成 */
function RelationWizard({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const names = useMemo(() => snapshot.objects.map((o) => o.name), [snapshot.objects]);
  const [to, setTo] = useState(names.find((n) => /棟/.test(n)) ?? (names[0] ?? ""));

  useEffect(() => {
    if (!to && names.length > 0) setTo(names[0]);
  }, [names.length, to]);

  const addAll = () => {
    if (!to) return;
    setSnapshot((prev) => {
      const extras = prev.objects
        .map((o) => o.name)
        .filter((n) => n !== to)
        .filter((from) => !prev.links.some((l) => l.from === from && l.to === to && l.label === "帰属"))
        .map((from) => ({ from, to, label: "帰属" as const }));
      return extras.length ? { ...prev, links: [...prev.links, ...extras] } : prev;
    });
  };

  return (
    <div className="rounded border p-3">
      <div className="text-sm font-semibold mb-2">関係をまとめて作る</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">すべてのオブジェクトを</span>
        <select className="border rounded px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-sm">
          へ <b>帰属</b> させる
        </span>
        <button type="button" className="px-3 py-1 rounded bg-black text-white" onClick={addAll}>
          実行
        </button>
      </div>
    </div>
  );
}

/** 手入力：オブジェクト */
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
      <div className="text-sm font-semibold mb-2">各オブジェクトを作り，整理しよう！</div>

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

/** ★ 手入力：リンク */
function ManualLinksForm({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const names = snapshot.objects.map((o) => o.name);
  const [from, setFrom] = useState(names[0] ?? "");
  const [to, setTo] = useState(names[1] ?? "");
  const [label, setLabel] = useState("帰属");

  useEffect(() => {
    if (!from && names.length) setFrom(names[0]);
    if (!to && names.length > 1) setTo(names[1]);
  }, [names.join("|")]);

  const add = () => {
    if (!from || !to || from === to) return;
    setSnapshot((prev) =>
      prev.links.some((l) => l.from === from && l.to === to && (l.label ?? "") === (label ?? ""))
        ? prev
        : { ...prev, links: [...prev.links, { from, to, label }] }
    );
  };

  return (
    <div className="rounded border p-3">
      <div className="text-sm font-semibold mb-2">リンクを作成</div>
      <div className="flex flex-wrap gap-2 items-center">
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
          className="border rounded px-2 py-1 w-32"
          placeholder="ラベル（例：帰属）"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" className="px-3 py-1 rounded bg-black text-white" onClick={add}>
          追加
        </button>
      </div>

      {/* 既存リンク一覧（削除も可） */}
      {snapshot.links.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="text-xs text-neutral-500 mb-1">現在のリンク</div>
          <div className="space-y-1">
            {snapshot.links.map((l, i) => (
              <div key={`${l.from}->${l.to}:${l.label ?? ""}:${i}`} className="flex items-center gap-2">
                <span>
                  {l.from} → {l.to}（{l.label ?? "関連"}）
                </span>
                <button
                  className="text-xs px-2 py-0.5 rounded border"
                  onClick={() =>
                    setSnapshot((prev) => ({
                      ...prev,
                      links: prev.links.filter((_, idx) => idx !== i),
                    }))
                  }
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 小物 */
function Chip(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={"text-sm px-2 py-1 rounded-full border bg-neutral-50 hover:bg-neutral-100 " + (className ?? "")}
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
