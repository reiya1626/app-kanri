// app/api/class-puml/route.ts
//
// B案（検証モード）:
//  - クラス統合は「type > なければ属性名集合」で行う（リンク有無では分割しない）
//  - 同一クラス内でリンク署名が揃っていない場合は warnings に検出結果を返す
//  - 多重度は保守的（個体差があれば 0..1、観測的に >=2 があれば *）
//  - 既存のサニタイズ/型推定は維持
//
// 返却: { puml, encoded, urlSvg, warnings?: Array<{className:string, message:string}> }

import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { encode } from "plantuml-encoder";

// ====== 型 ======
type Attr = { key: string; value: string };
type Obj  = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };
type Snapshot = { objects: Obj[]; links: Link[] };

type WarningItem = { className: string; message: string };

// ====== ユーティリティ ======
function esc(s: unknown): string {
  return String(s ?? "").replace(/"/g, '\\"');
}
function guessType(v: string): string {
  const s = String(v ?? "").trim();
  if (/^-?\d+$/.test(s)) return "int";
  if (/^-?\d+(\.\d+)?$/.test(s)) return "number";
  if (/^(true|false)$/i.test(s)) return "boolean";
  return "string";
}
// 属性名集合 → シグネチャ（順序非依存）
function attrSignature(attrs: Attr[] | undefined): string {
  const keys = Array.isArray(attrs)
    ? attrs.map(a => String(a.key ?? "").trim()).filter(Boolean)
    : [];
  keys.sort();
  return keys.join("|");
}

// ====== メイン ======
function buildClassDiagramPuml(
  snap: Snapshot,
  outWarnings: WarningItem[]
): string {
  const objs  = Array.isArray(snap.objects) ? snap.objects : [];
  const links = Array.isArray(snap.links)   ? snap.links   : [];

  // 名前 → オブジェクト
  const byName = new Map<string, Obj>();
  for (const o of objs) {
    const nm = String(o.name ?? "").trim();
    if (nm) byName.set(nm, o);
  }

  // 宛先“プロトタイプ”表現（type があれば type、無ければ属性名集合）
  const destProto = (toName: string) => {
    const o = byName.get(toName);
    if (!o) return "∅";
    const t = (typeof o.type === "string" && o.type.trim()) ? o.type.trim() : "";
    return t || `SIG(${attrSignature(o.attrs)})`;
  };

  // 1個体の「リンク署名」（from=name） 例: "履修する->SIG(学年),友人->TypeX"
  function linkSignatureOf(inst: string): string {
    const mine = links.filter(l => l.from === inst);
    const parts = mine.map(l => {
      const lab = (l.label?.trim() || "");
      return `${lab}->${destProto(l.to)}`;
    });
    parts.sort();
    return parts.join(",");
  }

  // 生成物
  const classOf   = new Map<string, string>();                   // instance -> className
  const classAttrs: Record<string, Map<string,string>> = {};     // className -> Map(attrName -> type)
  const classes   = new Set<string>();                           // className の集合
  const classMembers: Record<string, Set<string>> = {};          // className -> インスタンス集合
  const linkSigPerMember: Record<string, Map<string,string>> = {};// className -> Map(inst -> linkSig)

  // 未定クラス命名
  let undetSeq = 1;
  const sig2class = new Map<string, string>(); // 属性名シグネチャ -> className

  // ---- オブジェクトをクラスへ束ねる（B案: 属性名集合のみで統合）----
  for (const o of objs) {
    const inst = String(o.name ?? "").trim();
    if (!inst) continue;

    let cname = (typeof o.type === "string" && o.type.trim()) ? o.type.trim() : "";
    if (!cname) {
      const aSig = attrSignature(o.attrs);
      if (sig2class.has(aSig)) cname = sig2class.get(aSig)!;
      else {
        cname = `未定${undetSeq++}`;
        sig2class.set(aSig, cname);
      }
    }

    classOf.set(inst, cname);
    classes.add(cname);
    (classMembers[cname] ??= new Set()).add(inst);

    // 属性型は“最初の観測”を採用
    const bucket = (classAttrs[cname] ??= new Map<string,string>());
    const kvs = Array.isArray(o.attrs) ? o.attrs : [];
    for (const { key, value } of kvs) {
      const k = String(key ?? "").trim();
      if (!k) continue;
      if (!bucket.has(k)) bucket.set(k, guessType(String(value ?? "")));
    }

    // 検証用に各メンバーのリンク署名を記録
    (linkSigPerMember[cname] ??= new Map()).set(inst, linkSignatureOf(inst));
  }

  // ---- クラス内リンク署名の不一致を検出（警告）----
  for (const cname of classes) {
    const sigs = new Set<string>([...(linkSigPerMember[cname]?.values() ?? [])]);
    if (sigs.size > 1) {
      outWarnings.push({
        className: cname,
        message:
          `同一クラス内で関係（ラベル/宛先型）の有無・種類が不一致です。` +
          `（例: 一部の個体だけ「履修する->心理学」を持つ など）`
      });
    }
  }

  // ---- リンクをクラス間に集約 ----
  type EdgeKey = string;
  const edge: Record<EdgeKey, {
    fromC: string; toC: string; label?: string;
    samples: Array<{ fromInst: string; toInst: string }>;
  }> = {};

  for (const e of links) {
    const fromC = classOf.get(e.from);
    const toC   = classOf.get(e.to);
    if (!fromC || !toC) continue;

    const lab = e.label?.trim() || undefined;
    const key = `${fromC}|${toC}|${lab ?? ""}`;
    (edge[key] ??= { fromC, toC, label: lab, samples: [] })
      .samples.push({ fromInst: e.from, toInst: e.to });
  }

  // ---- 多重度（保守的）----
  function mult(
    samples: Array<{ fromInst: string; toInst: string }>,
    fromClassSize: number,
    toClassSize: number
  ) {
    const mapF: Record<string, Set<string>> = {};
    const mapT: Record<string, Set<string>> = {};
    for (const s of samples) {
      (mapF[s.fromInst] ??= new Set()).add(s.toInst);
      (mapT[s.toInst]   ??= new Set()).add(s.fromInst);
    }
    const maxToPerFrom = Math.max(0, ...Object.values(mapF).map(s => s.size));
    const maxFromPerTo = Math.max(0, ...Object.values(mapT).map(s => s.size));

    // “一部だけ関係がある”状況を 0..1 で表現（観測で >=2 かつ両側サイズ>=2 のときだけ *）
    const right = (maxToPerFrom >= 2 && fromClassSize >= 2) ? "*" : "0..1";
    const left  = (maxFromPerTo >= 2 && toClassSize   >= 2) ? "*" : "0..1";
    return { left, right };
  }

  // ---- データ無し時の安全図 ----
  if (classes.size === 0) {
    return `@startuml
title クラス図（データなし）
class "Snapshot" { note = "オブジェクトを追加してください" }
@enduml`;
  }

  // ---- クラス定義 ----
  const classBlocks = [...classes].map(c => {
    const attrs = classAttrs[c];
    const lines = attrs ? [...attrs.entries()].map(([k,t]) => `  ${esc(k)} : ${t}`) : [];
    return `class "${esc(c)}" {\n${lines.join("\n")}\n}`;
  }).join("\n\n");

  // ---- 関連 ----
  const rels = Object.values(edge).map(ed => {
    const fromSize = classMembers[ed.fromC]?.size ?? 0;
    const toSize   = classMembers[ed.toC]?.size   ?? 0;
    const m = mult(ed.samples, fromSize, toSize);
    const lab = ed.label ? ` : ${esc(ed.label)}` : "";
    return `"${esc(ed.fromC)}" "${m.right}" -- "${m.left}" "${esc(ed.toC)}"${lab}`;
  }).join("\n");

  return `@startuml
skinparam linetype ortho
skinparam classAttributeFontSize 12

${classBlocks}

${rels}
@enduml`;
}

// ====== エンドポイント ======
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as unknown));
    const raw  = (body as any)?.snapshot ?? body;

    // 入力サニタイズ
    const objects: Obj[] = Array.isArray((raw as any)?.objects)
      ? (raw as any).objects
          .map((o: unknown): Obj => {
            const name = String((o as any)?.name ?? "").trim();
            const type = (typeof (o as any)?.type === "string" && (o as any).type.trim())
              ? (o as any).type.trim()
              : undefined;
            const attrs: Attr[] = Array.isArray((o as any)?.attrs)
              ? (o as any).attrs
                  .map((a: unknown): Attr => ({
                    key:   String((a as any)?.key   ?? "").trim(),
                    value: String((a as any)?.value ?? ""),
                  }))
                  .filter((a: Attr) => a.key !== "")
              : [];
            return { name, type, attrs };
          })
          .filter((o: Obj) => o.name !== "")
      : [];

    const links: Link[] = Array.isArray((raw as any)?.links)
      ? (raw as any).links
          .map((l: unknown): Link => {
            const from = String((l as any)?.from ?? "").trim();
            const to   = String((l as any)?.to   ?? "").trim();
            const labelRaw = (l as any)?.label != null ? String((l as any).label).trim() : "";
            return { from, to, label: labelRaw !== "" ? labelRaw : undefined };
          })
          .filter((l: Link) => l.from !== "" && l.to !== "")
      : [];

    const safe: Snapshot = { objects, links };

    const warnings: WarningItem[] = [];
    const puml    = buildClassDiagramPuml(safe, warnings);
    const encoded = encode(puml);
    const urlSvg  = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    // 警告は UI 側で任意に表示できるよう JSON に同梱
    return NextResponse.json({ puml, encoded, urlSvg, warnings }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as any)?.message ?? "bad request" },
      { status: 400 }
    );
  }
}
