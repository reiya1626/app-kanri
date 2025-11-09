// app/level2/page.tsx
"use client";

import React, { useEffect, useState, JSX } from "react";
import { useProblemConfig } from "../../components/problem-config";

// ---- 型定義 ----
type Attr = { key: string; value: string };
type Obj = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

export default function Level2Page() {
  const { classProblemText, objectProblemText } = useProblemConfig();

  const [snapshot, setSnapshot] = useState<Snapshot>({ objects: [], links: [] });
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [objErr, setObjErr] = useState("");
  const [clsPumlUrl, setClsPumlUrl] = useState("");
  const [clsErr, setClsErr] = useState("");
  const [autoClass, setAutoClass] = useState(true);

  const isEmptySnapshot = (s: Snapshot) =>
    (!s.objects || s.objects.length === 0) &&
    (!s.links || s.links.length === 0);

  // オブジェクト図プレビュー
  useEffect(() => {
    if (isEmptySnapshot(snapshot)) {
      setObjPumlUrl("");
      setObjErr("");
      return;
    }
    const id = setTimeout(async () => {
      try {
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

  // クラス図推定
  useEffect(() => {
    if (!autoClass) return;
    if ((snapshot.objects?.length ?? 0) === 0) {
      setClsPumlUrl("");
      setClsErr("");
      return;
    }
    const id = setTimeout(async () => {
      try {
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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 問題文表示（読み取り専用・高さ固定＋スクロール） */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h1 className="text-xl font-semibold">
          レベル2：ヒント付きでオブジェクト図を作成しよう
        </h1>

        <div>
          <div className="text-sm font-semibold mb-1">
            クラス図作成問題（本文）
          </div>
          <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {classProblemText || "（トップページで問題文を設定してください）"}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">
            オブジェクト図作成問題（本文）
          </div>
          <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {objectProblemText || "（トップページで問題文を設定してください）"}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：レベル2用UI（ヒント＋自力） */}
        <section className="rounded-lg border bg-white p-4 space-y-4">
          <h2 className="font-semibold text-sm">
            ステップ：ヒントボタンを使いながら、自分でオブジェクト図を組み立てよう
          </h2>

          {/* ヒント用：ワンクリックで代表的なオブジェクトや属性を追加 */}
          <QuickAdd snapshot={snapshot} setSnapshot={setSnapshot} />

          {/* 自由入力フォーム */}
          <ManualObjectsForm snapshot={snapshot} setSnapshot={setSnapshot} />

          {/* 関連追加ミニUI */}
          <LinkMiniAdder snapshot={snapshot} setSnapshot={setSnapshot} />

          {/* デバッグ（必要に応じて残す/消す） */}
          <div className="text-xs text-neutral-600">
            <div className="font-semibold mb-1">現在のスナップショット</div>
            <pre className="rounded border bg-neutral-50 p-2 h-32 overflow-auto">
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </div>
        </section>

        {/* 右上：オブジェクト図プレビュー */}
        <section className="rounded-lg border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">
              （入力中のプレビュー）オブジェクト図
            </div>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded border"
              onClick={() => {
                if (
                  !isEmptySnapshot(snapshot) &&
                  !confirm("プレビューと入力内容をクリアします。よろしいですか？")
                )
                  return;
                setSnapshot({ objects: [], links: [] });
                setObjPumlUrl("");
                setObjErr("");
                setClsPumlUrl("");
                setClsErr("");
              }}
            >
              クリア
            </button>
          </div>
          <div className="p-4">
            {objErr && (
              <div className="text-xs text-red-600 mb-2">
                API error: {objErr}
              </div>
            )}
            {objPumlUrl ? (
              <img alt="object-uml" src={objPumlUrl} />
            ) : (
              <div className="text-xs text-neutral-500">
                オブジェクトやリンクを追加するとここに図が表示されます。
              </div>
            )}
          </div>
        </section>

        {/* 右下：クラス図推定 */}
        <section className="rounded-lg border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">クラス図（推定）</div>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={autoClass}
                  onChange={(e) => setAutoClass(e.target.checked)}
                />
                自動変換
              </label>
            </div>
          </div>
          <div className="p-4">
            {clsErr && (
              <div className="text-xs text-red-600 mb-2">
                API error: {clsErr}
              </div>
            )}
            {clsPumlUrl ? (
              <img alt="class-uml" src={clsPumlUrl} />
            ) : (
              <div className="text-xs text-neutral-500">
                オブジェクト図ができると、ここにクラス図の推定結果が表示されます。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** =========================
 * QuickAdd：代表例をワンクリック追加
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
        : {
            ...prev,
            objects: [...prev.objects, { name, type, attrs: [] }],
          }
    );

  const addAttr = (of: string, key: string, value: string) =>
    setSnapshot((prev) => upsertAttr(prev, of, key, value));

  const addLink = (from: string, to: string, label?: string) =>
    setSnapshot((prev) =>
      prev.links.some(
        (l) =>
          l.from === from &&
          l.to === to &&
          (l.label ?? "") === (label ?? "")
      )
        ? prev
        : { ...prev, links: [...prev.links, { from, to, label }] }
    );

  return (
    <div className="rounded border p-3 space-y-2 text-sm">
      <div className="font-semibold">
        ヒント：代表的な要素をワンクリックで追加
      </div>

      <div className="text-xs opacity-70">オブジェクト</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addObject("マンション物件1", "物件")}>
          マンション物件1
        </Chip>
        <Chip onClick={() => addObject("マンション物件2", "物件")}>
          マンション物件2
        </Chip>
        <Chip onClick={() => addObject("棟A", "棟")}>棟A</Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">スロット候補</div>
      <div className="flex gap-2 flex-wrap">
        <Chip
          onClick={() =>
            addAttr("マンション物件1", "所在地", "長野市松代町東条1-2-3")
          }
        >
          物件1: 所在地=長野市松代町東条1-2-3
        </Chip>
        <Chip
          onClick={() => addAttr("マンション物件1", "販売価格", "2980万円")}
        >
          物件1: 販売価格=2980万円
        </Chip>
        <Chip
          onClick={() => addAttr("マンション物件1", "部屋番号", "502号室")}
        >
          物件1: 部屋番号=502号室
        </Chip>
        <Chip
          onClick={() => addAttr("マンション物件2", "販売価格", "4150万円")}
        >
          物件2: 販売価格=4150万円
        </Chip>
        <Chip
          onClick={() => addAttr("マンション物件2", "部屋番号", "1203号室")}
        >
          物件2: 部屋番号=1203号室
        </Chip>
      </div>

      <div className="text-xs opacity-70 mt-1">リンク候補</div>
      <div className="flex gap-2 flex-wrap">
        <Chip onClick={() => addLink("マンション物件1", "棟A", "帰属")}>
          物件1 → 棟A（帰属）
        </Chip>
        <Chip onClick={() => addLink("マンション物件2", "棟A", "帰属")}>
          物件2 → 棟A（帰属）
        </Chip>
      </div>
    </div>
  );
}

/** =========================
 * ManualObjectsForm：自由にオブジェクト＋属性
 * ========================= */
function ManualObjectsForm({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const addObject = () =>
    setSnapshot((prev) => ({
      ...prev,
      objects: [...prev.objects, { name: "", attrs: [] }],
    }));

  const updateName = (idx: number, name: string) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      objects[idx] = { ...objects[idx], name };
      return { ...prev, objects };
    });

  const addAttrTo = (idx: number) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      const t = { ...(objects[idx] ?? { attrs: [] }) };
      t.attrs = [...(t.attrs ?? []), { key: "", value: "" }];
      objects[idx] = t;
      return { ...prev, objects };
    });

  const updateAttr = (idx: number, aidx: number, patch: Partial<Attr>) =>
    setSnapshot((prev) => {
      const objects = [...prev.objects];
      const o = {
        ...objects[idx],
        attrs: [...(objects[idx].attrs ?? [])],
      };
      o.attrs[aidx] = { ...o.attrs[aidx], ...patch };
      objects[idx] = o;
      return { ...prev, objects };
    });

  const removeObject = (idx: number) =>
    setSnapshot((prev) => {
      const name = prev.objects[idx]?.name;
      const objects = prev.objects.filter((_, i) => i !== idx);
      const links = prev.links.filter(
        (l) => l.from !== name && l.to !== name
      );
      return { objects, links };
    });

  return (
    <div className="rounded border p-3 space-y-3 text-sm">
      <div className="font-semibold">
        自分でオブジェクトとスロットを編集してみよう
      </div>

      {snapshot.objects.map((o, idx) => (
        <div key={idx} className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs text-neutral-500">オブジェクト名</div>
            <input
              className="border rounded px-2 py-1 w-full text-xs"
              placeholder="例: マンション物件1"
              value={o.name}
              onChange={(e) => updateName(idx, e.target.value)}
            />
            <button
              type="button"
              className="text-[10px] px-2 py-1 rounded border"
              onClick={() => removeObject(idx)}
            >
              削除
            </button>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500">スロット一覧</div>
            {(o.attrs ?? []).map((a, aidx) => (
              <div key={aidx} className="flex items-center gap-2">
                <input
                  className="border rounded px-2 py-1 w-32 text-[10px]"
                  placeholder="key（例：販売価格）"
                  value={a.key}
                  onChange={(e) =>
                    updateAttr(idx, aidx, { key: e.target.value })
                  }
                />
                <input
                  className="border rounded px-2 py-1 flex-1 text-[10px]"
                  placeholder='value（例："2980万円"）'
                  value={a.value}
                  onChange={(e) =>
                    updateAttr(idx, aidx, { value: e.target.value })
                  }
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-1 text-[10px] px-2 py-1 rounded border"
            onClick={() => addAttrTo(idx)}
          >
            ＋ スロット追加
          </button>
        </div>
      ))}

      <button
        type="button"
        className="px-3 py-1 rounded bg-black text-white text-xs"
        onClick={addObject}
      >
        ＋ オブジェクトを追加
      </button>
    </div>
  );
}

/** =========================
 * LinkMiniAdder：オブジェクト間リンク追加
 * ========================= */
function LinkMiniAdder({
  snapshot,
  setSnapshot,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
}) {
  const names = snapshot.objects.map((o) => o.name).filter(Boolean);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(names[0] ?? "");
  const [to, setTo] = useState(names[1] ?? "");
  const [label, setLabel] = useState("帰属");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!names.includes(from)) setFrom(names[0] ?? "");
    if (!names.includes(to))
      setTo(names.find((n) => n !== from) ?? names[0] ?? "");
  }, [names.join("|")]); // eslint-disable-line

  const add = () => {
    setMsg(null);
    if (!from || !to) return setMsg("from/to を選択してください");
    if (from === to) return setMsg("from と to が同じです");

    setSnapshot((prev) => {
      const exists = prev.links.some(
        (l) =>
          l.from === from &&
          l.to === to &&
          (l.label ?? "") === (label ?? "")
      );
      if (exists) {
        setMsg("同じリンクがすでにあります");
        return prev;
      }
      setMsg("追加しました");
      return {
        ...prev,
        links: [...prev.links, { from, to, label }],
      };
    });
  };

  if (names.length < 2) {
    return (
      <div className="text-xs">
        ＋ リンクを追加（※オブジェクトが2つ以上あると使えます）
      </div>
    );
  }

  return (
    <div className="rounded border p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">リンクを追加する</div>
        {msg && <div className="text-[10px] text-green-700">{msg}</div>}
      </div>

      <button
        type="button"
        className="px-2 py-1 rounded border"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "閉じる" : "＋ リンク入力欄を開く"}
      </button>

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="border rounded px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <span>→</span>
          <select
            className="border rounded px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <input
            className="border rounded px-2 py-1 w-24"
            placeholder="ラベル"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            type="button"
            className="px-2 py-1 rounded bg-black text-white"
            onClick={add}
          >
            追加
          </button>
        </div>
      )}
    </div>
  );
}

/** =========================
 * 共通：Chip / upsertAttr
 * ========================= */
function Chip(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>
): JSX.Element {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={
        "text-[10px] px-2 py-1 rounded-full border bg-neutral-50 hover:bg-neutral-100 " +
        (className ?? "")
      }
    />
  );
}

function upsertAttr(
  prev: Snapshot,
  of: string,
  key: string,
  value: string
): Snapshot {
  const objects = [...prev.objects];
  let i = objects.findIndex((o) => o.name === of);
  if (i < 0) {
    objects.push({ name: of, attrs: [{ key, value }] });
    i = objects.length - 1;
  } else {
    const o = { ...objects[i], attrs: [...(objects[i].attrs ?? [])] };
    const k = o.attrs.findIndex((a) => a.key === key);
    if (k >= 0) o.attrs[k] = { key, value };
    else o.attrs.push({ key, value });
    objects[i] = o;
  }
  return { ...prev, objects };
}
