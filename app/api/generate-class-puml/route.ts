// app/api/generate-class-puml/route.ts

// Next.js が提供するサーバー側の機能を使うために
// リクエスト/レスポンス用の型を読み込む
//オブジェクト軍から推定クラス図のPumlを生成
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// PlantUML のテキストを URL 用に圧縮/エンコードするライブラリ
import { encode } from "plantuml-encoder";

// ==== 型定義 ====

// スロット(属性) 1 件分
type Attr = { key: string; value: string };
// オブジェクト 1 件分
type Obj = { name: string; type?: string; attrs?: Attr[] };
// リンク 1 本分
type Link = { from: string; to: string; label?: string };
// スナップショット
type Snapshot = { objects: Obj[]; links: Link[] };

// B案：クラス推定時の警告（図の外に出す）
type WarningItem = { className: string; message: string };

// ==== ユーティリティ ====

// ダブルクォートを軽くエスケープして PUML 内で安全に使えるようにする
function esc(s: unknown): string {
  return String(s ?? "").replace(/"/g, '\\"');
}

// 値からざっくり型推定（本格的じゃなくて OK）
function guessType(v: string): string {
  const s = String(v ?? "").trim();
  // 先に厳密な整数 → 次に実数 → それ以外は文字列
  if (/^[+-]?\d+$/.test(s)) return "int";
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return "number";
  return "string";
}

// 型のマージ（複数サンプルから最も“広い”型へ）
// int + int -> int, int + number -> number, それ以外が混ざれば string
function mergeType(a: string | undefined, b: string | undefined): string {
  const A = a ?? "string";
  const B = b ?? "string";
  if (A === B) return A;
  const set = new Set([A, B]);
  if (set.has("string")) return "string";
  if (set.has("number")) return "number";
  // ここに来るのは (int, number) 以外はほぼ無い想定
  return "number";
}

// 属性キーの正規化（空白類の統一・前後トリムのみ）
// ※ 同義語吸収は行わない（方針どおり）
function normKey(key: string): string {
  return String(key ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// オブジェクトの「属性キー集合シグネチャ」を作る（完全一致で同一クラス統合）
function signatureOf(obj: Obj): string {
  const keys = (obj.attrs ?? [])
    .map((a) => normKey(a.key))
    .filter((k) => k.length > 0)
    .sort();
  return keys.join("|");
}

// ==== メイン：スナップショットからクラス図用 PUML を組み立て ====

function buildClassDiagramPuml(
  snap: Snapshot
): { puml: string; warnings: WarningItem[] } {
  const objs = Array.isArray(snap.objects) ? snap.objects : [];
  const links = Array.isArray(snap.links) ? snap.links : [];

  // 1) 同一クラス統合（属性名集合が完全一致のオブジェクトは同一クラス）
  const buckets = new Map<
    string,
    { className: string; members: Obj[]; attrTypes: Map<string, string> }
  >();
  let classCounter = 1;

  for (const o of objs) {
    const name = (o.name ?? "").trim();
    if (!name) continue;

    const sig = signatureOf(o);
    if (!buckets.has(sig)) {
      buckets.set(sig, {
        className: `未定${classCounter++}`, // 仮名（UI から後で編集してもOK）
        members: [],
        attrTypes: new Map<string, string>(),
      });
    }
    const bucket = buckets.get(sig)!;
    bucket.members.push(o);

    // 属性の型を集計（guessType をマージ）
    for (const { key, value } of o.attrs ?? []) {
      const k = normKey(key);
      if (!k) continue;
      const t = guessType(String(value ?? ""));
      const prev = bucket.attrTypes.get(k);
      bucket.attrTypes.set(k, mergeType(prev, t));
    }
  }



  // 2) インスタンス名 → クラス名の対応を作る
  const classOf = new Map<string, string>();
  for (const b of buckets.values()) {
    for (const m of b.members) {
      classOf.set((m.name ?? "").trim(), b.className);
    }
  }

  // 3) クラス定義ブロック（属性は「型」を表示）
  const classBlocks = Array.from(buckets.values())
    .map((b) => {
      const lines = Array.from(b.attrTypes.entries()).map(
        ([k, t]) => `  ${esc(k)} : ${t}`
      );
      return `class "${esc(b.className)}" {\n${lines.join("\n")}\n}`;
    })
    .join("\n\n");

  // 4) 関連（多重度とラベルを推定）
  //    - 同一クラス間の重複リンクを統合（対称扱い：キーは辞書順の組）
  type EdgeKey = string;
  type Sample = { fromInst: string; toInst: string };
  type Edge = {
    aClass: string;
    bClass: string;
    label?: string;
    samples: Sample[]; // インスタンス間リンクのサンプル
  };

  const edges: Record<EdgeKey, Edge> = {};

  const normLabel = (s: unknown) => {
    const v = String(s ?? "").trim();
    return v === "" ? undefined : v;
  };

  for (const e of links) {
    const fi = (e.from ?? "").trim();
    const ti = (e.to ?? "").trim();
    if (!fi || !ti) continue;

    const fc = classOf.get(fi);
    const tc = classOf.get(ti);
    if (!fc || !tc) continue;

    // 対称扱いでキー化（クラス名の辞書順）
    const A = fc <= tc ? fc : tc;
    const B = fc <= tc ? tc : fc;
    const lab = normLabel(e.label);
    const key = `${A}|${B}|${lab ?? ""}`;

    if (!edges[key]) {
      edges[key] = { aClass: A, bClass: B, label: lab, samples: [] };
    }
    edges[key].samples.push({ fromInst: fi, toInst: ti });
  }

  // 多重度の推定（サンプルから）
  function multiplicity(
    samples: Sample[],
    aMembers: string[],
    bMembers: string[],
    aOf: Map<string, string>,
    bOf: Map<string, string>
  ) {
    // a側：各 a インスタンスが何個の b と繋がったか
    const aMap: Record<string, Set<string>> = {};
    // b側：各 b インスタンスが何個の a と繋がったか
    const bMap: Record<string, Set<string>> = {};

    for (const s of samples) {
      const f = s.fromInst;
      const t = s.toInst;
      // どちらが a/b かはクラス名で再判定
      const fClass = aOf.get(f) || bOf.get(f); // どちらにもなり得る
      const tClass = aOf.get(t) || bOf.get(t);

      // f が aClass側、t が bClass側のケース
      if (fClass && tClass && fClass === aOf.get(f) && tClass === bOf.get(t)) {
        (aMap[f] ??= new Set()).add(t);
        (bMap[t] ??= new Set()).add(f);
        continue;
      }
      // 逆（f が b, t が a）
      if (fClass && tClass && fClass === bOf.get(f) && tClass === aOf.get(t)) {
        (aMap[t] ??= new Set()).add(f);
        (bMap[f] ??= new Set()).add(t);
      }
    }

    const maxBPerA =
      Object.values(aMap).reduce((m, s) => Math.max(m, s.size), 0) || 0;
    const maxAPerB =
      Object.values(bMap).reduce((m, s) => Math.max(m, s.size), 0) || 0;

    // PUML 記法に合わせて、"A" "右側" -- "左側" "B"
    return {
      right: maxBPerA <= 1 ? "0..1" : "*", // A側に書く多重度（右）
      left: maxAPerB <= 1 ? "0..1" : "*",  // B側に書く多重度（左）
      aMap,
      bMap,
    };
  }

  // クラス名 → メンバー名の配列
  const classMembers = new Map<string, string[]>();
  for (const b of buckets.values()) {
    classMembers.set(
      b.className,
      b.members.map((m) => (m.name ?? "").trim()).filter(Boolean)
    );
  }

  // 5) B案：警告収集
  const warnings: WarningItem[] = [];

  // 実際の関連の PUML 行を作る
  const relLines: string[] = [];

  for (const ed of Object.values(edges)) {
    const aClass = ed.aClass;
    const bClass = ed.bClass;
    const label = ed.label ? ` : ${esc(ed.label)}` : "";

    // クラス名 -> メンバー名の配列
    const aMembers = classMembers.get(aClass) ?? [];
    const bMembers = classMembers.get(bClass) ?? [];

    // メンバー -> 所属クラス名の逆引き（簡易に Map を準備）
    const aOf = new Map<string, string>();
    const bOf = new Map<string, string>();
    aMembers.forEach((m) => aOf.set(m, aClass));
    bMembers.forEach((m) => bOf.set(m, bClass));

    const mult = multiplicity(ed.samples, aMembers, bMembers, aOf, bOf);

    // 警告：クラス内の一部インスタンスがこの関連に不参加
    // a 側
    const aJoined = new Set(Object.keys(mult.aMap));
    if (aMembers.length > 0 && aJoined.size < aMembers.length) {
      const missing = aMembers.filter((m) => !aJoined.has(m));
      warnings.push({
        className: aClass,
        message: `関連${ed.label ? `「${ed.label}」` : ""}（相手: ${bClass}）に未接続のインスタンスがあります: ${missing.join(", ")}`,
      });
    }
    // b 側
    const bJoined = new Set(Object.keys(mult.bMap));
    if (bMembers.length > 0 && bJoined.size < bMembers.length) {
      const missing = bMembers.filter((m) => !bJoined.has(m));
      warnings.push({
        className: bClass,
        message: `関連${ed.label ? `「${ed.label}」` : ""}（相手: ${aClass}）に未接続のインスタンスがあります: ${missing.join(", ")}`,
      });
    }

    // PUML 行
    // 多重度はクラス名の外側に書く
    relLines.push(
      `"${esc(aClass)}" "${mult.right}" -- "${mult.left}" "${esc(bClass)}"${label}`
    );
  }

  // クラス図全体 PUML
  const puml = `@startuml
skinparam linetype ortho
skinparam classAttributeFontSize 12

${classBlocks}

${relLines.join("\n")}

@enduml`;

  return { puml, warnings };
}

// ==== エンドポイント本体 ====

// 外部からのアクセスが可能な export 関数（POST メソッド用）
// レベル3などのページから fetch("/api/generate-class-puml", { body: { snapshot }})
// で呼び出されることを想定
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // フロント側はいま { snapshot } で送っているのでそれを優先的に読む
    const raw = body?.snapshot ?? body;

    // --- 入力途中のゴミをここで掃除してからアルゴリズムに渡す ---
    const objects: Obj[] = Array.isArray(raw?.objects)
      ? raw.objects
          .map((o: any): Obj => {
            const name = String(o?.name ?? "").trim();
            const type =
              typeof o?.type === "string" && o.type.trim()
                ? o.type.trim()
                : undefined;

            const attrs: Attr[] = Array.isArray(o?.attrs)
              ? o.attrs
                  .map((a: any): Attr => ({
                    key: String(a?.key ?? "").trim(),
                    value: String(a?.value ?? ""),
                  }))
                  .filter((a: Attr) => a.key !== "") // key が空は除外
              : [];

            return { name, type, attrs };
          })
          .filter((o: Obj) => o.name !== "") // 名前が空のオブジェクトは除外
      : [];

    // from/to 空は除外。label は空文字なら undefined に。
    const links: Link[] = Array.isArray(raw?.links)
      ? raw.links
          .map((l: any): Link => {
            const from = String(l?.from ?? "").trim();
            const to = String(l?.to ?? "").trim();
            const labelRaw =
              l?.label != null ? String(l.label).trim() : "";
            return {
              from,
              to,
              label: labelRaw !== "" ? labelRaw : undefined,
            };
          })
          .filter((l: Link) => l.from !== "" && l.to !== "")
      : [];

    const safe: Snapshot = { objects, links };

    // ここまで来た時点で「壊れた PUML になりにくい」ので 404/500 が出にくくなる
    const { puml, warnings } = buildClassDiagramPuml(safe);
    if (!/^@startuml[\s\S]*@enduml\s*$/.test(puml)) {
      return NextResponse.json(
        { error: "生成されたPUMLが不正です。", puml },
        { status: 400 }
      );
    }
    const encoded = encode(puml);
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    // 警告も一緒に返す（B案）
    return NextResponse.json({ puml, encoded, urlSvg, warnings }, { status: 200 });
  } catch (e: any) {
    // ここで 400 を返すのは「サーバー側で例外が起きたときだけ」
    return NextResponse.json(
      { error: e?.message ?? "bad request" },
      { status: 400 }
    );
  }
}
