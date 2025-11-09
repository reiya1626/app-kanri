//Next.jsが提供するサーバー側の木の洞利用するためにリクエストのデータと応答データという部品を読み込んでる
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { encode } from "plantuml-encoder"; // ← 型は types/plantuml-encoder.d.ts で補完

// ダブルクォート等の軽いエスケープ
function esc(s: any): string {
  return String(s ?? "").replace(/"/g, '\\"');
}
// buildObjectDiagramPuml関数では，オブジェクトのリストとリンクのリストを含むsnapというデータを受け取り，処理を開始する
//?をつけることで，データがなくてもエラーが出ないよう工夫
function buildObjectDiagramPuml(snap: {
  id?: string;
  name?: string;
  objects?: Array<{
    name: string;
    attrs?: Array<{ key: string; value: string }>;
    // 将来的に typeName を渡したい場合に備え、柔軟に見る
    type?: string;
    className?: string;
  }>;
  links?: Array<{ from: string; to: string; label?: string }>;
}) {
  //snap(入力データ)にnameがあればそれ使う．なければsnapshotという文字列をtitle変数に設定
  const title = snap?.name ?? "snapshot";
  const objs = Array.isArray(snap?.objects) ? snap.objects : [];
  const links = Array.isArray(snap?.links) ? snap.links : [];

  // 表示ラベルの辞書（リンク生成で再利用）
  // key: インスタンス名（元の name）、value: 下線付き表示ラベル "<u>instance : type</u>"
  const labelMap = new Map<string, string>();

  //名前が有効なオブジェクトだけをfilterで選び出す．
  const objBlocks = objs
    .filter((o) => typeof o?.name === "string" && o.name.trim())
    .map((o) => {
      //各オブジェクト(o)から名前を取り出し，前後の空白を削除して(trim)つかう．
      const instanceName = o.name.trim();

      // 厳密表記「インスタンス名 : クラス名」を採用（typeName は別途供給想定）
      const typeNameRaw =
        (typeof (o as any)?.type === "string" && (o as any).type) ||
        (typeof (o as any)?.className === "string" && (o as any).className) ||
        ""; // なければ空

      const labelPlain = typeNameRaw
        ? `${instanceName} : ${typeNameRaw}`
        : instanceName;

      const underlinedLabel = `<u>${esc(labelPlain)}</u>`;
      labelMap.set(instanceName, underlinedLabel);
      // ----------------------

      const attrs =
        Array.isArray(o.attrs) && o.attrs.length > 0
          ? o.attrs.map((a) => `  ${esc(a.key)} = "${esc(a.value)}"`).join("\n")
          : "";

      // エイリアス(as)は使わず表示名のみ（日本語OK）
      return `object "${underlinedLabel}" {\n${attrs}\n}`;
    })
    .join("\n");
  
  //リンクのPlantUMLコード文字列を格納する変数relsの作成をしてる．元データlinksを使って処理を続ける
  //links配列からfromとtoの両方が有効なオブジェクト名のリンクだけを選び出す
  const rels = links
    .filter(
      (e) =>
        typeof e?.from === "string" &&
        e.from.trim() &&
        typeof e?.to === "string" &&
        e.to.trim()
    )
    .map((e) => {
      // ノードの表示名は「<u>インスタンス : クラス</u>」にしているため、
      // リンク側も同一ラベルを使って一致させる
      const fromInstance = e.from.trim();
      const toInstance = e.to.trim();
      const fromLbl = labelMap.get(fromInstance) ?? `<u>${esc(fromInstance)}</u>`;
      const toLbl = labelMap.get(toInstance) ?? `<u>${esc(toInstance)}</u>`;
      return `"${fromLbl}" -- "${toLbl}"${e.label ? ` : ${esc(e.label)}` : ""}`;
    })
    .join("\n");
  
  //PlantUMLコードを以下のように返す
  //skinparamで文字の大きさやリンクの線の曲がり方など見た目を設定
  return `@startuml
  skinparam objectAttributeFontSize 12
  skinparam linetype ortho
  ${objBlocks}
  ${rels}
  @enduml`;
}

//外部からのアクセスが可能なexport,非同期関数のasyncを使い，HTTPのPOSTリクエストを処理する関数を定義
//reqはリクエスト(クライアントからの情報)データ
export async function POST(req: NextRequest) {
  try {
    //await req.json()でリクエストの中身(ボディ)をJSON形式で読み込み，bodyに格納
    //JSON解析に失敗した場合は，エラーを無視して空のオブジェクト{}を設定し，処理が中断しないようにしてる
    const body = await req.json().catch(() => ({}));

    // いろんな形で来ても取り出せるようにする（寛容）
    const snap =
      body?.id && body?.objects
        ? body
        : Array.isArray(body?.snapshots)
        ? body.snapshots[0]
        : body?.snapshot ?? body;

    const safeSnap = {
      id: String(snap?.id ?? "S"),
      name: String(snap?.name ?? "snapshot"),
      objects: Array.isArray(snap?.objects) ? snap.objects : [],
      links: Array.isArray(snap?.links) ? snap.links : [],
    };

    //整形されたデータ(safeSnap)を定義済みの関数buildObjectDiagramPumlに渡し，PlantUML形式のコード文字列(puml)を生成
    const puml = buildObjectDiagramPuml(safeSnap);
    //PlntUMLコードをencode関数を使って圧縮・エンコードする．これにより，コードをURLに含める
    const encoded = encode(puml); // HUFFMAN
    //エンコードされたPlantUMLコードを組み込み，外部のPlantUMLサービスから図のSVG画像を取得するための完全なURLを生成
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;

    return NextResponse.json({ puml, encoded, urlSvg }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "bad request", stack: e?.stack },
      { status: 400 }
    );
  }
}
