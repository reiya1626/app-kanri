// app/api/class-puml/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { encode } from "plantuml-encoder";

// ------------- 型 -------------
type Attr = { key: string; value: string };
type Obj  = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

// ------------- ユーティリティ -------------
// クラス名の推定：type があればそれ、なければ「末尾の番号/記号を除いた名前」を使う
function guessClassName(o: Obj): string {
  if (o.type && o.type.trim()) return o.type.trim();
  const n = (o.name ?? "").trim();
  if (!n) return "Object";
  // 例: "マンション物件1" -> "マンション物件", "棟A" -> "棟"
  //           数字・英字1語などを末尾から落とす
  const m = n.match(/^(.*?)(?:[0-9０-９A-Za-zａ-ｚＡ-Ｚ]+)?$/);
  const base = (m?.[1] ?? n).trim();
  return base || n;
}

// 文字の軽いエスケープ
const esc = (s: any) => String(s ?? "").replace(/"/g, '\\"');

// ------------- 変換：Snapshot -> ClassModel -------------
type ClassModel = {
  classes: Record<string, Set<string>>; // className -> attrKeys
  assocs: Array<{ from: string; to: string; label?: string; multFrom?: string; multTo?: string }>;
};

function inferClassModel(snap: Snapshot): ClassModel {
  const classes: Record<string, Set<string>> = {};
  const objToClass = new Map<string, string>(); // instanceName -> className

  // 1) クラス集合＆属性キーの集約
  for (const o of snap.objects ?? []) {
    const c = guessClassName(o);
    objToClass.set(o.name, c);
    if (!classes[c]) classes[c] = new Set<string>();
    for (const a of o.attrs ?? []) {
      // 値ではなく「属性名」を集約
      if (a.key && a.key.trim()) classes[c].add(a.key.trim());
    }
  }

  // 2) 関連（ラベルと多重度の粗推定）
  // 多重度ルール（ヒューリスティック）：
  //   同一クラスC1の複数インスタンスが、同じクラスC2のインスタンスへリンクしていたら C1側「*」、C2側「1」
  //   それ以外は「*」–「*」にしておく
  const assocsRaw: Array<{ from: string; to: string; label?: string }> = [];
  for (const l of snap.links ?? []) {
    const cf = objToClass.get(l.from);
    const ct = objToClass.get(l.to);
    if (!cf || !ct) continue;
    assocsRaw.push({ from: cf, to: ct, label: l.label });
  }

  // ペアごとに集計
  type PairKey = string;
  const pairCounts: Record<PairKey, { cf: string; ct: string; label?: string; byTarget: Map<string, Set<string>> }> = {};
  const keyOf = (cf: string, ct: string, label?: string) => `${cf}__${ct}__${label ?? ""}`;

  for (const a of assocsRaw) {
    const k = keyOf(a.from, a.to, a.label);
    if (!pairCounts[k]) pairCounts[k] = { cf: a.from, ct: a.to, label: a.label, byTarget: new Map() };
    // どの「ターゲット・インスタンス名」へ何件の from インスタンスが向いているかを数えたいが、
    // スナップショットはクラスに正規化されているのでここはヒューリスティックとして
    // 「同じクラス間に複数リンクがあれば *→1 を採用」くらいに単純化
    // （より精密にやりたい場合は links を instance 単位で再集計して下さい）
    const bucket = pairCounts[k].byTarget;
    const targetId = "any"; // 粗い近似
    if (!bucket.has(targetId)) bucket.set(targetId, new Set());
    bucket.get(targetId)!.add("from"); // ダミーカウント
  }

  const assocs: ClassModel["assocs"] = [];
  for (const k of Object.keys(pairCounts)) {
    const p = pairCounts[k];
    // ここでは「複数リンクが存在するなら *→1、なければ *→*」の超簡単ルール
    const many = [...p.byTarget.values()].some((s) => (s?.size ?? 0) > 1);
    assocs.push({
      from: p.cf,
      to: p.ct,
      label: p.label,
      multFrom: many ? "*" : "*",
      multTo: many ? "1" : "*",
    });
  }

  return { classes, assocs };
}

// ------------- PlantUML（class） -------------
function buildClassPuml(snap: Snapshot): string {
  const model = inferClassModel(snap);

  const classBlocks = Object.entries(model.classes)
    .map(([cn, attrSet]) => {
      const attrs = [...attrSet].map((k) => `  ${esc(k)} : string`).join("\n");
      return `class "${esc(cn)}" {\n${attrs}\n}`;
    })
    .join("\n\n");

  const relations = model.assocs
    .map((a) => {
      const mFrom = a.multFrom ? ` "${a.multFrom}"` : "";
      const mTo   = a.multTo   ? ` "${a.multTo}"` : "";
      const lab   = a.label ? ` : ${esc(a.label)}` : "";
      return `"${esc(a.from)}"${mFrom} -->${mTo} "${esc(a.to)}"${lab}`;
    })
    .join("\n");

  return `@startuml
skinparam classAttributeIconSize 0
skinparam linetype ortho

${classBlocks}

${relations}
@enduml`;
}

// ------------- API -------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // スナップショットの取り出し（object-puml と同様の“寛容”ロジック）
    const snap: Snapshot =
      body?.id && body?.objects
        ? body
        : Array.isArray(body?.snapshots)
        ? body.snapshots[0]
        : body?.snapshot ?? body;

    const safeSnap: Snapshot = {
      objects: Array.isArray(snap?.objects) ? snap.objects : [],
      links: Array.isArray(snap?.links) ? snap.links : [],
    };

    const puml = buildClassPuml(safeSnap);
    const encoded = encode(puml);
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    return NextResponse.json({ puml, encoded, urlSvg }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "bad request" }, { status: 400 });
  }
}
