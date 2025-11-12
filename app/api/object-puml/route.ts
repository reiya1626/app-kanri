//Next.jsが提供するサーバー側の機能を利用するために
//リクエストのデータと応答データという部品を読み込んでる
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { encode } from "plantuml-encoder"; // ← 型は types/plantuml-encoder.d.ts で補完

// ダブルクォート等の軽いエスケープ
function esc(s: any): string {
  return String(s ?? "").replace(/"/g, '\\"');
}

// 値を UML 記法として安全に出力するためのヘルパ
// - 数値っぽい文字列: 120, -5, 3.14 → そのまま (例: key = 120)
// - true / false (大文字小文字いろいろ): → 小文字でそのまま (例: key = true)
// - それ以外: ダブルクォートで囲む (例: key = "長野市松代町")
function toPumlLiteral(v: any): string {
  const s = String(v ?? "").trim();

  // 整数 or 小数
  if (/^[+-]?\d+$/.test(s) || /^[+-]?\d+\.\d+$/.test(s)) {
    return s;
  }

  // boolean
  if (/^(true|false)$/i.test(s)) {
    return s.toLowerCase();
  }

  // それ以外は文字列として扱う
  return `"${esc(s)}"`;
}

// buildObjectDiagramPuml関数では，オブジェクトのリストとリンクのリストを含むsnapというデータを受け取り，
// PlantUML のオブジェクト図コードを生成する
function buildObjectDiagramPuml(snap: {
  id?: string;
  name?: string;
  objects?: Array<{
    name?: any;
    attrs?: Array<{ key?: any; value?: any }>;
    // 将来的に typeName を渡したい場合に備え、柔軟に見る
    type?: any;
    className?: any;
  }>;
  links?: Array<{ from?: any; to?: any; label?: any }>;
}): string {
  const objs = Array.isArray(snap?.objects) ? snap.objects : [];
  const links = Array.isArray(snap?.links) ? snap.links : [];

  // 表示ラベルの辞書（リンク生成で再利用）
  // key: インスタンス名（元の name）、value: 下線付き表示ラベル "<u>instance : type</u>"
  const labelMap = new Map<string, string>();

  // オブジェクト定義ブロック
  const objBlocks = objs
    .map((raw) => {
      const name = String(raw?.name ?? "").trim();
      if (!name) return null; // 未入力行は捨てる

      // type / className があれば "インスタンス : クラス" にする（なくてもOK）
      const typeNameRaw =
        (typeof raw?.type === "string" && raw.type.trim()) ||
        (typeof raw?.className === "string" && raw.className.trim()) ||
        "";

      const labelPlain = typeNameRaw ? `${name} : ${typeNameRaw}` : name;
      const underlined = `<u>${esc(labelPlain)}</u>`;
      labelMap.set(name, underlined);

      // attrs: key/value はなんでも来てよいが、
      // key が空のものは捨て、value は toPumlLiteral で UML 的なリテラルに整形
      const attrs = Array.isArray(raw?.attrs)
        ? raw.attrs
            .map((a) => {
              const k = String(a?.key ?? "").trim();
              if (!k) return null;
              const lit = toPumlLiteral(a?.value);
              return `  ${esc(k)} = ${lit}`;
            })
            .filter((line): line is string => !!line)
            .join("\n")
        : "";

      return `object "${underlined}" {\n${attrs}\n}`;
    })
    .filter((b): b is string => !!b)
    .join("\n");

  // リンク定義ブロック
  const rels = links
    .map((raw) => {
      const from = String(raw?.from ?? "").trim();
      const to = String(raw?.to ?? "").trim();
      if (!from || !to) return null;

      const fromLbl = labelMap.get(from) ?? `<u>${esc(from)}</u>`;
      const toLbl = labelMap.get(to) ?? `<u>${esc(to)}</u>`;
      const labelText = String(raw?.label ?? "").trim();

      return `"${fromLbl}" -- "${toLbl}"${
        labelText ? ` : ${esc(labelText)}` : ""
      }`;
    })
    .filter((line): line is string => !!line)
    .join("\n");

  // 有効なオブジェクトもリンクも無い場合：最低限の UML として返す
  if (!objBlocks && !rels) {
    return `@startuml
skinparam objectAttributeFontSize 12
skinparam linetype ortho
' まだ有効なオブジェクトがありません
@enduml`;
  }

  // 通常パターン
  return `@startuml
skinparam objectAttributeFontSize 12
skinparam linetype ortho

${objBlocks}

${rels}
@enduml`;
}

// 外部からの POST リクエストを処理
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // いろんな形で来ても取り出せるようにする（寛容）
    const snap =
      body?.id && body?.objects
        ? body
        : Array.isArray(body?.snapshots)
        ? body.snapshots[0]
        : body?.snapshot ?? body;

    const puml = buildObjectDiagramPuml(snap ?? {});
    const encoded = encode(puml); // URL 用にエンコード
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    return NextResponse.json({ puml, encoded, urlSvg }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "bad request", stack: e?.stack },
      { status: 400 }
    );
  }
}
