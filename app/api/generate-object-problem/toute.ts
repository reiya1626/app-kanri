export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type GenParams = {
  classProblemText: string;
  constraints?: {
    objectCount?: { min: number; max: number };
    numericRanges?: Record<string, { min: number; max: number }>;
    properNounStyle?: "日本人名" | "英字名" | "混在";
    domainHints?: string[];
    seed?: number;
  };
};

const apiKey = process.env.OPENAI_API_KEY;
const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** A) LLMで “場面プラン(JSON)” を作る */
async function generateScenePlan(p: GenParams) {
  const sys = `
あなたは情報モデリングの教育支援アシスタントです。
与えられた「要求文（クラス図課題の本文）」から、オブジェクト図に対応する
「具体的な場面」を次のJSONスキーマで作成してください（追加キー禁止）。

{
  "objects": [ { "name": "会員A", "type": "会員", "attrs": { "会員番号": "1234" } } ],
  "links":   [ { "from": "会員A", "to": "本『SQL入門』", "label": "借りる" } ]
}

要件:
- objects: 具体個体。name=固有名、type=概念名。attrsは key=value を2〜3個程度。
- links: 具体的な関係（動詞/名詞句）。from/to は objects の name を参照。
- constraints を尊重しつつ、要求文の意味を保ち最小限で一貫性のある場面にする。
- 出力はJSON 1つのみ。
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
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "{}";
  const jsonText = text.match(/\{[\s\S]*\}$/)?.[0] ?? text; // 余分が来た時の保険
  return JSON.parse(jsonText) as { objects: any[]; links: any[] };
}

/** B) JSON→日本語1段落の “状況文” に整形 */
function renderProblemJapanese(plan: { objects: any[]; links: any[] }) {
  const objs = plan.objects.map(o => {
    const attrs = o?.attrs
      ? Object.entries(o.attrs).map(([k,v]) => `${k}=${v}`).join("、")
      : "";
    return attrs ? `${o.name}（${o.type}, ${attrs}）` : `${o.name}（${o.type}）`;
  });
  const rels = plan.links.map(l => `「${l.from}」が「「${l.to}」」を${l.label}`.replace("「「","「").replace("」」","」"));

  const s1 = objs.length ? `登場人物や物として、${objs.join("、")}がある。` : "";
  const s2 = rels.length ? `${rels.join("。")}。` : "";
  return `${s1}${s1 && s2 ? " " : ""}${s2}`.trim();
}

/** C) フォールバック（キーなし/失敗時でも必ず返す） */
function fallbackSentence() {
  return "本文に登場する具体的な個体に固有値（名前や数値）を設定し、相互の関係が1〜2個わかる状況を1段落で作成しなさい。";
}

export async function POST(req: Request) {
  const body = (await req.json()) as GenParams;

  if (!apiKey) {
    return NextResponse.json({ objectProblemText: fallbackSentence() });
  }

  try {
    const plan = await generateScenePlan(body);
    const sentence = renderProblemJapanese(plan);
    return NextResponse.json({ objectProblemText: sentence, plan });
  } catch (e) {
    console.error("gen failed:", e);
    return NextResponse.json({ objectProblemText: fallbackSentence() });
  }
}
