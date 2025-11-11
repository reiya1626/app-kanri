// Next.js が提供するサーバー側の機能を利用するために
// リクエストのデータ(NextRequest)と応答データ(NextResponse)という部品を読み込んでる
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { encode } from "plantuml-encoder"; // ← 型は types/plantuml-encoder.d.ts で補完

/** =========================
 * ユーティリティ
 * ========================= */

// ダブルクォート等の軽いエスケープ
function esc(s: any): string {
  return String(s ?? "").replace(/"/g, '\\"');
}

// この API に渡されるスナップショットの型（ゆるめ）
type SnapshotInput = {
  id?: string;
  name?: string;
  objects?: Array<{
    name: string;
    attrs?: Array<{ key: string; value: string }>;
    // 将来的に typeName / className を渡したい場合に備えておく
    type?: string;
    className?: string;
  }>;
  links?: Array<{ from: string; to: string; label?: string }>;
};

/** =========================
 * オブジェクト図用 PlantUML を組み立てる
 * ========================= */
function buildObjectDiagramPuml(snap: SnapshotInput): string {
  const titleRaw = typeof snap?.name === "string" ? snap.name.trim() : "";
  const useTitle =
    titleRaw && titleRaw !== "snapshot" ? `title ${esc(titleRaw)}\n` : "";

  const objs = Array.isArray(snap?.objects) ? snap.objects : [];
  const links = Array.isArray(snap?.links) ? snap.links : [];

  const labelMap = new Map<string, string>();

  const objBlocks = objs
    .filter(
      (o): o is NonNullable<SnapshotInput["objects"]>[number] =>
        typeof o?.name === "string" && o.name.trim().length > 0
    )
    .map((o) => {
      const instanceName = o.name.trim();
      const typeNameRaw =
        (typeof o.type === "string" && o.type) ||
        (typeof o.className === "string" && o.className) ||
        "";
      const labelPlain = typeNameRaw
        ? `${instanceName} : ${typeNameRaw}`
        : instanceName;
      const underlinedLabel = `<u>${esc(labelPlain)}</u>`;
      labelMap.set(instanceName, underlinedLabel);

      const attrs =
        Array.isArray(o.attrs) && o.attrs.length > 0
          ? o.attrs
              .map(
                (a: { key: string; value: string }) =>
                  `  ${esc(a.key)} = "${esc(a.value)}"`
              )
              .join("\n")
          : "";

      return `object "${underlinedLabel}" {\n${attrs}\n}`;
    })
    .join("\n");

  const rels = links
    .filter(
      (e): e is { from: string; to: string; label?: string } =>
        typeof e?.from === "string" &&
        e.from.trim().length > 0 &&
        typeof e?.to === "string" &&
        e.to.trim().length > 0
    )
    .map((e) => {
      const fromInstance = e.from.trim();
      const toInstance = e.to.trim();
      const fromLbl =
        labelMap.get(fromInstance) ?? `<u>${esc(fromInstance)}</u>`;
      const toLbl =
        labelMap.get(toInstance) ?? `<u>${esc(toInstance)}</u>`;
      return `"${fromLbl}" -- "${toLbl}"${
        e.label ? ` : ${esc(e.label)}` : ""
      }`;
    })
    .join("\n");

  return `@startuml
${useTitle}skinparam objectAttributeFontSize 12
skinparam linetype ortho

${objBlocks}

${rels}
@enduml`;
}


/** =========================
 * API エンドポイント本体 (POST)
 * ========================= */
// 外部からのアクセスが可能な export。
// 非同期関数 async を使い，HTTP の POST リクエストを処理する。
export async function POST(req: NextRequest) {
  try {
    // リクエスト body を JSON として読み込む。
    // JSON 解析に失敗した場合は、エラーを無視して {} を使い、処理を中断しないようにする。
    const body: any = await req.json().catch(() => ({}));

    // いろんな形で来ても取り出せるようにする（寛容設計）
    const snapCandidate: any =
      body?.id && body?.objects
        ? body
        : Array.isArray(body?.snapshots)
        ? body.snapshots[0]
        : body?.snapshot ?? body;

    // 最低限の安全な形に整形（足りなければ空配列にする）
    const safeSnap: SnapshotInput = {
      id: snapCandidate?.id
        ? String(snapCandidate.id)
        : undefined,
      name: snapCandidate?.name
        ? String(snapCandidate.name)
        : "snapshot",
      objects: Array.isArray(snapCandidate?.objects)
        ? snapCandidate.objects
        : [],
      links: Array.isArray(snapCandidate?.links)
        ? snapCandidate.links
        : [],
    };

    // 整形されたデータ(safeSnap)を使って PlantUML 文字列を生成
    const puml = buildObjectDiagramPuml(safeSnap);

    // PlantUML コードを encode して URL に載せられる形にする
    const encoded = encode(puml); // HUFFMAN 圧縮 + エンコード

    // 外部の PlantUML サービスから SVG を取得するための URL
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    // クライアントには puml 本体と URL の両方を返す
    return NextResponse.json(
      { puml, encoded, urlSvg },
      { status: 200 }
    );
  } catch (e: any) {
    // 何かおかしくなった場合は 400 としてエラー内容を返す
    return NextResponse.json(
      {
        error: e?.message ?? "bad request",
        stack: e?.stack,
      },
      { status: 400 }
    );
  }
}
