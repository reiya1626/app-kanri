// app/level1/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useProblemConfig } from "../../components/problem-config";

/** ========= 型 ========= */
type Attr = { key: string; value: string };
type Obj = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

type GoldSpec = Record<
  string,
  { slots: { key: string; value: string }[]; links: { to: string; label?: string }[] }
>;

type QuizItem =
  | {
      id: string;
      kind: "slot";
      label: string;
      correct: boolean;
      payload: { of: string; key: string; value: string };
    }
  | {
      id: string;
      kind: "link";
      label: string;
      correct: boolean;
      payload: { from: string; to: string; label?: string };
    };

/** ========= 正答PUML解析 =========
 */
function parseObjectPumlToGold(puml: string | null | undefined): GoldSpec {
  const gold: GoldSpec = {};
  if (!puml) return gold;

  const lines = puml.split(/\r?\n/);
  const aliasToName: Record<string, string> = {};

  // --- 1周目: objectブロックと属性 ---
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw.startsWith("object")) continue;

    // object "名前" as ALIAS {
    // object 名前 as ALIAS {
    // （どちらにも対応）
    const m =
      raw.match(/^object\s+"([^"]+)"\s*(?:as\s+([\w\d_]+))?\s*\{/u) ||
      raw.match(/^object\s+([\w\d_]+)\s*(?:as\s+([\w\d_]+))?\s*\{/u);
    if (!m) continue;

    const name = (m[1] || "").trim();
    const alias = (m[2] || "").trim();
    if (!name) continue;

    if (!gold[name]) gold[name] = { slots: [], links: [] };
    if (alias) aliasToName[alias] = name;

    // ブロック内の属性行を読む
    i++;
    for (; i < lines.length; i++) {
      const inner = lines[i].trim();
      if (inner.startsWith("}")) break;

      // 例: 所在地 = "長野市..." / price = 100
      const attrMatch = inner.match(
        /^([\p{L}0-9_一-龯ぁ-んァ-ンー]+)\s*=\s*"?([^"]+)"?/u
      );
      if (attrMatch) {
        const key = attrMatch[1].trim();
        const value = attrMatch[2].trim();
        if (key) {
          gold[name].slots.push({ key, value });
        }
      }
    }
  }

  // --- 2周目: リンク行 ---
  for (const raw of lines) {
    const line = raw.trim();
    // A -- B : Label
    const m = line.match(/^(.+?)\s+--\s+(.+?)(?::\s*(.+))?$/);
    if (!m) continue;

    let from = m[1].trim().replace(/^"|"$/g, "");
    let to = m[2].trim().replace(/^"|"$/g, "");
    const label = m[3]?.trim();

    // alias 解決
    from = aliasToName[from] || from;
    to = aliasToName[to] || to;

    if (!from || !to) continue;

    if (!gold[from]) gold[from] = { slots: [], links: [] };
    gold[from].links.push({ to, label });
  }

  return gold;
}

/** ========= ページ本体 ========= */
export default function Level1Page() {
  const {
    classProblemText,
    objectProblemText,
    objectAnswerPuml, // 教員トップで保存したオブジェクト図正答PUML
  } = useProblemConfig();

  // 正答PUML → GOLD（選択肢の元データ）
  const gold = useMemo(
    () => parseObjectPumlToGold(objectAnswerPuml),
    [objectAnswerPuml]
  );
  const hasGold = Object.keys(gold).length > 0;

  const [snapshot, setSnapshot] = useState<Snapshot>({ objects: [], links: [] });
  const [objPumlUrl, setObjPumlUrl] = useState("");
  const [objErr, setObjErr] = useState("");
  const [clsPumlUrl, setClsPumlUrl] = useState("");
  const [clsErr, setClsErr] = useState("");
  const [autoClass, setAutoClass] = useState(true);

  const isEmptySnapshot = (s: Snapshot) =>
    (!s.objects || s.objects.length === 0) &&
    (!s.links || s.links.length === 0);

  // ---- オブジェクト図プレビュー ----
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

  // ---- クラス図推定 ----
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
      {/* 問題文表示（教師が設定したもの） */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h1 className="text-xl font-semibold">
          レベル1：ガイド付きオブジェクト図トレーニング
        </h1>

        <div>
          <div className="text-sm font-semibold mb-1">
            クラス図作成問題（本文）
          </div>
          <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap h-32 overflow-auto">
            {classProblemText || "（トップページでクラス図問題文を設定してください）"}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">
            オブジェクト図作成問題（本文）
          </div>
          <div className="text-sm bg-neutral-50 border rounded p-2 whitespace-pre-wrap h-32 overflow-auto">
            {objectProblemText || "（トップページでオブジェクト図問題文を設定してください）"}
          </div>
        </div>

        <div className="text-xs text-neutral-500">
          Guidedモードの選択肢は「オブジェクト図 正答例 PlantUML」から自動生成します。
        </div>
        {!hasGold && (
          <div className="text-xs text-red-600">
            ※ オブジェクト図の正答例 PlantUML が未設定か、対応形式として解釈できません。
            トップページからアップロードしてください。
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左：Guidedモード */}
        <section className="rounded-lg border bg-white p-4 space-y-4">
          <h2 className="font-semibold text-sm">
            ステップ1：正答PUMLから抽出された情報を使ってオブジェクト図を学ぼう
          </h2>
          {hasGold ? (
            <GuidedMode
              snapshot={snapshot}
              setSnapshot={setSnapshot}
              gold={gold}
            />
          ) : (
            <div className="text-xs text-neutral-600">
              正答例PUMLが設定されていないため、ガイドモードは利用できません。
            </div>
          )}
        </section>

        {/* 右：オブジェクト図プレビュー */}
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
                  !confirm("プレビューをクリアします。よろしいですか？")
                )
                  return;
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
                ガイドで「正答を反映」を押すと、ここにオブジェクト図が表示されます。
              </div>
            )}
          </div>
        </section>

        {/* クラス図推定 */}
        <section className="rounded-lg border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">クラス図（推定）</div>
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={autoClass}
                onChange={(e) => setAutoClass(e.target.checked)}
              />
              自動変換
            </label>
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

/** ========= GuidedMode（gold 必須） ========= */
function GuidedMode({
  snapshot,
  setSnapshot,
  gold,
}: {
  snapshot: Snapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
  gold: GoldSpec;
}) {
  const [enabled, setEnabled] = useState(true);
  const [target, setTarget] = useState<string>("");
  const [choices, setChoices] = useState<QuizItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [judged, setJudged] = useState(false);

  const objectNames = Object.keys(gold);

  useEffect(() => {
    if (!target) return;
    setChoices(generateQuizFor(target, gold));
    setSelected({});
    setJudged(false);
  }, [target, gold]);

  const score = useMemo(() => {
    if (!judged) return null;
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

  const applyCorrect = () => {
    if (!judged) return;
    setSnapshot((prev) => {
      let cur = { ...prev };
      for (const c of choices) {
        if (!c.correct) continue;
        if (c.kind === "slot") {
          cur = upsertAttr(cur, c.payload.of, c.payload.key, c.payload.value);
        } else {
          const { from, to, label } = c.payload;
          if (
            !cur.links.some(
              (l) =>
                l.from === from &&
                l.to === to &&
                (l.label ?? "") === (label ?? "")
            )
          ) {
            cur = { ...cur, links: [...cur.links, { from, to, label }] };
          }
        }
      }
      if (target && !cur.objects.some((o) => o.name === target)) {
        cur = {
          ...cur,
          objects: [...cur.objects, { name: target, attrs: [] }],
        };
      }
      return cur;
    });
  };

  if (objectNames.length === 0) {
  return (
    <div className="text-xs text-red-600">
      正答例PUMLからオブジェクトを抽出できませんでした。
      記法を確認してください（object "名前" as 別名 {"{"}...{"}"} / A -- B : ラベル）。
    </div>
  );
}

  return (
    <div className="border rounded p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          レベル1ガイド：正答PUMLから正しい情報を選択
        </div>
      </div>

      {/* 対象オブジェクト選択 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span>オブジェクトを選択：</span>
        <select
          className="border rounded px-2 py-1"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">選択してね</option>
          {objectNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {target && (
        <>
          <div className="text-xs text-neutral-600">
            正答用PUMLから抽出した候補です。正しいスロット・関連だけにチェックを入れてください。
          </div>
          <div className="space-y-2">
            {choices.map((c) => {
              const sel = !!selected[c.id];
              const isOk = judged && sel && c.correct;
              const isNg = judged && sel && !c.correct;
              return (
                <label
                  key={c.id}
                  className={
                    "flex items-center gap-2 px-2 py-1 rounded cursor-pointer " +
                    (isOk
                      ? "bg-green-50"
                      : isNg
                      ? "bg-red-50"
                      : "bg-neutral-50")
                  }
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={(e) =>
                      setSelected((s) => ({
                        ...s,
                        [c.id]: e.target.checked,
                      }))
                    }
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-2">
            <button
              className="px-3 py-1 border rounded"
              onClick={() => setJudged(true)}
            >
              採点
            </button>
            {judged && score && (
              <>
                <span>
                  正解 {score.ok}/{score.total}
                  {score.ng ? ` （誤選択 ${score.ng}）` : ""}
                </span>
                <button
                  className="px-3 py-1 rounded bg-black text-white"
                  onClick={applyCorrect}
                >
                  正答をオブジェクト図に反映
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** ========= クイズ生成 ========= */
function generateQuizFor(target: string, gold: GoldSpec): QuizItem[] {
  const spec = gold[target] ?? { slots: [], links: [] };
  const others = Object.entries(gold).filter(([name]) => name !== target);

  const items: QuizItem[] = [];

  // 正答スロット
  spec.slots.forEach((s, i) =>
    items.push({
      id: `SOK-${i}`,
      kind: "slot",
      correct: true,
      label: `${s.key} = "${s.value}"`,
      payload: { of: target, key: s.key, value: s.value },
    })
  );

  // 正答スロット集合（ダミー重複防止）
  const correctSet = new Set(spec.slots.map((s) => `${s.key}::${s.value}`));

  // ダミースロット（他オブジェクトの属性）
  others.forEach(([oname, oSpec], oi) => {
    oSpec.slots.forEach((s, si) => {
      const sig = `${s.key}::${s.value}`;
      if (correctSet.has(sig)) return;
      items.push({
        id: `SNG-${oi}-${si}`,
        kind: "slot",
        correct: false,
        label: `${s.key} = "${s.value}"`,
        payload: { of: target, key: s.key, value: s.value },
      });
    });
  });

  // リンク（target のリンクが正解、それ以外は誤り）
  Object.entries(gold).forEach(([fromName, fromSpec], fi) => {
    fromSpec.links.forEach((l, li) => {
      const isCorrect = fromName === target;
      items.push({
        id: `L-${fi}-${li}`,
        kind: "link",
        correct: isCorrect,
        label: `${fromName} → ${l.to}${l.label ? `（${l.label}）` : ""}`,
        payload: { from: fromName, to: l.to, label: l.label },
      });
    });
  });

  // シャッフル
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

/** ========= スナップショットへの属性反映 ========= */
function upsertAttr(
  prev: Snapshot,
  of: string,
  key: string,
  value: string
): Snapshot {
  const objs = [...prev.objects];
  let i = objs.findIndex((o) => o.name === of);
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
