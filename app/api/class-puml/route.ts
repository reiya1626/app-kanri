// app/api/class-puml/route.ts

// Next.js が提供するサーバー側の機能を使うために
// リクエスト/レスポンス用の型を読み込む
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

// ==== ユーティリティ ====

// ダブルクォートを軽くエスケープして PUML 内で安全に使えるようにする
function esc(s: unknown): string {
  return String(s ?? "").replace(/"/g, '\\"');
}

// 値からざっくり型推定（本格的じゃなくて OK）
function guessType(v: string): string {
  const s = String(v ?? "").trim();
  if (/^\d+$/.test(s)) return "int";
  if (/^\d+(\.\d+)?$/.test(s)) return "number";
  return "string";
}

// ==== メイン：スナップショットからクラス図用 PUML を組み立て ====

// 引数 snap は「きれいにした objects / links が入っている」前提
function buildClassDiagramPuml(snap: { objects: Obj[]; links: Link[] }): string {
  const objs = Array.isArray(snap.objects) ? snap.objects : [];
  const links = Array.isArray(snap.links) ? snap.links : [];

  // 各インスタンス -> クラス名
  const classOf = new Map<string, string>();
  // 各クラス -> 属性 (Map で key 重複を防ぐ)
  const classAttrs: Record<string, Map<string, string>> = {};
  // 登場したクラス名の集合
  const classes = new Set<string>();

  // --- オブジェクトからクラス候補とクラス属性を集める ---
  for (const o of objs) {
    const instName = (o.name ?? "").trim();
    if (!instName) continue; // 念のため防御

    // 1. type が入っていればそれを優先
    // 2. 「○号室」「○棟」などから雑に型名を抜く（あなたの元コードを活かす）
    // 3. それも無ければ「◯◯型」とする
    const cname =
      (o.type && o.type.trim()) ||
      (o.name
        ?.replace(/.*?([一二三四五六七八九十\d]+)?(号室|棟|階|物件)$/, "$2")
        .trim()) ||
      `${instName}型`;

    classOf.set(instName, cname);
    classes.add(cname);

    const kvs = Array.isArray(o.attrs) ? o.attrs : [];
    if (!classAttrs[cname]) classAttrs[cname] = new Map<string, string>();

    for (const { key, value } of kvs) {
      const k = String(key ?? "").trim();
      if (!k) continue;
      if (!classAttrs[cname].has(k)) {
        classAttrs[cname].set(k, guessType(String(value ?? "")));
      }
    }
  }

  // --- リンクからクラス間関連 + 多重度を集計 ---
  type EdgeKey = string;
  const edge: Record<
    EdgeKey,
    {
      fromC: string;
      toC: string;
      label?: string;
      samples: Array<{ fromInst: string; toInst: string }>;
    }
  > = {};

  for (const e of links) {
    const fromC = classOf.get(e.from);
    const toC = classOf.get(e.to);
    if (!fromC || !toC) continue; // クラスに対応づけられない場合は無視

    const lab = e.label?.trim() || undefined;
    const key = `${fromC}|${toC}|${lab ?? ""}`;

    if (!edge[key]) {
      edge[key] = { fromC, toC, label: lab, samples: [] };
    }
    edge[key].samples.push({ fromInst: e.from, toInst: e.to });
  }

  // サンプルからざっくり多重度を推定
  function mult(samples: Array<{ fromInst: string; toInst: string }>) {
    const mapF: Record<string, Set<string>> = {};
    const mapT: Record<string, Set<string>> = {};

    for (const s of samples) {
      (mapF[s.fromInst] ??= new Set()).add(s.toInst);
      (mapT[s.toInst] ??= new Set()).add(s.fromInst);
    }

    const maxToPerFrom =
      Object.values(mapF).reduce((m, set) => Math.max(m, set.size), 0) || 0;
    const maxFromPerTo =
      Object.values(mapT).reduce((m, set) => Math.max(m, set.size), 0) || 0;

    // 左右の位置に注意:
    // "A" "右側" -- "左側" "B"
    return {
      left: maxFromPerTo <= 1 ? "0..1" : "*",
      right: maxToPerFrom <= 1 ? "0..1" : "*",
    };
  }

  // --- オブジェクトもリンクも何も無いときの安全策 ---
  if (classes.size === 0) {
    return `@startuml
title クラス図（データなし）
class "Snapshot" {
  note = "オブジェクト図を入力するとクラス図がここに生成されます"
}
@enduml`;
  }

  // --- クラス定義ブロック ---
  const classBlocks = [...classes]
    .map((c) => {
      const attrs = classAttrs[c];
      const lines = attrs
        ? [...attrs.entries()].map(([k, t]) => `  ${esc(k)} : ${t}`)
        : [];
      return `class "${esc(c)}" {\n${lines.join("\n")}\n}`;
    })
    .join("\n\n");

  // --- 関連 ---
  const rels = Object.values(edge)
    .map((ed) => {
      const m = mult(ed.samples);
      const lab = ed.label ? ` : ${esc(ed.label)}` : "";
      // 多重度はクラス名の「外側」に書く PUML 記法
      return `"${esc(ed.fromC)}" "${m.right}" -- "${m.left}" "${esc(
        ed.toC
      )}"${lab}`;
    })
    .join("\n");

  // --- 最終的な PlantUML コード ---
  return `@startuml
title クラス図（オブジェクト図からの推定）
skinparam linetype ortho
skinparam classAttributeFontSize 12

${classBlocks}

${rels}
@enduml`;
}

// ==== エンドポイント本体 ====

// 外部からのアクセスが可能な export 関数（POST メソッド用）
// レベル3などのページから fetch("/api/class-puml", { body: { snapshot }})
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
          .filter((l: Link) => l.from !== "" && l.to !== "") // from/to が空は除外
      : [];

    const safe = { objects, links };

    // ここまで来た時点で「壊れた PUML になりにくい」ので 404 が出にくくなる
    const puml = buildClassDiagramPuml(safe);
    const encoded = encode(puml);
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    return NextResponse.json({ puml, encoded, urlSvg }, { status: 200 });
  } catch (e: any) {
    // ここで 400 を返すのは「サーバー側で例外が起きたときだけ」
    return NextResponse.json(
      { error: e?.message ?? "bad request" },
      { status: 400 }
    );
  }
}
