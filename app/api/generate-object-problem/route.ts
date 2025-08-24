export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type GenParams = {
  classProblemText: string;
  // 具体度コントロール（任意）
  constraints?: {
    objectCount?: { min: number; max: number };   // 例: 3〜7個
    numericRanges?: Record<string, { min: number; max: number }>; // 例: price, roomNo など
    properNounStyle?: "日本人名" | "英字名" | "混在"; // 固有名のスタイル
    domainHints?: string[]; // 業務語彙ヒント（"会員", "貸出記録" など）
    seed?: number; // 再現性用（同じseedなら似た出力）
  };
};

const apiKey = process.env.OPENAI_API_KEY!;
const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Step A: 構造プラン（JSON）を生成
async function generateScenePlan(p: GenParams) {
  const sys = `
あなたは情報モデリングの教育支援アシスタントです。
与えられた「要求文（クラス図課題の本文）」から、オブジェクト図に相当する
「具体的な場面」を JSON で構造化してください。

出力は必ず次の JSON スキーマに従ってください（追加キー禁止）:
{
  "objects": [ { "name": "会員A", "type": "会員", "attrs": { "会員番号": "1234" } } ],
  "links":   [ { "from": "会員A", "to": "本『SQL入門』", "label": "借りる" } ]
}

要件:
- objects: 具体的個体（固有値）を列挙。「name」は固有名、「type」は概念名
- attrs: key=value を複数。ただし過剰にならない（各オブジェクト2〜3個程度）
- links: 具体的な関係（動詞または名詞句）
- 要求文の意味合いを破壊しない範囲で、最小限の一貫した場面にする
- 数量や値は constraints を尊重するが、無理なときは自然さを優先
- 出力は JSON 1つだけ
  `.trim();

  const user = `
[要求文]
${p.classProblemText}

[constraints]
${JSON.stringify(p.constraints ?? {}, null, 2)}
  `.trim();

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });

  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "{}";
  // JSONだけを取り出す（余分が来た時の保険）
  const jsonText = text.match(/\{[\s\S]*\}$/)?.[0] ?? text;
  return JSON.parse(jsonText) as { objects: any[]; links: any[] };
}

// Step B: JSONから日本語の状況文を組み立てる
function renderProblemJapanese(plan: {objects: any[]; links: any[]}) {
  // 1段落で、状況だけを書く（命令文・見出しなし）
  const objs = plan.objects.map(o => {
    const attrs = o.attrs ? Object.entries(o.attrs).map(([k,v])=>`${k}=${v}`).join("、") : "";
    return attrs ? `${o.name}（${o.type}, ${attrs}）` : `${o.name}（${o.type}）`;
  });

  // 関係文
  const rels = plan.links.map(l => `「${l.from}」が「${l.to}」を${l.label}`);

  const s1 = objs.length ? `登場人物や物として、${objs.join("、")}がある。` : "";
  const s2 = rels.length ? `${rels.join("。")}。` : "";

  // 2文で十分。長すぎると学生の読み負担になるため。
  return `${s1}${s1 && s2 ? " " : ""}${s2}`.trim();
}

export async function POST(req: Request) {
  const body = (await req.json()) as GenParams;
  // キーがない環境でも落ちないように、簡易フォールバック
  if (!apiKey) {
    const fallback = "具体的な個体（名前や数値を含む）を設定し、相互の関係が1〜2個わかる状況を1段落で作成しなさい。";
    return NextResponse.json({ objectProblemText: fallback });
  }

  const plan = await generateScenePlan(body);
  const sentence = renderProblemJapanese(plan);
  return NextResponse.json({ objectProblemText: sentence, plan }); // planも返すとデバッグ/改善に便利
}
