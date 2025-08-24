// app/problems/index.ts
// レベル1の色分けタグ:
//  - オブジェクト: {{obj:インスタンス名|class:クラス名}}   ※class は省略可
//  - スロット:     {{slot:キー|value:値|of:インスタンス名}}

export type Problem = { id: string; title: string; text: string };

export const Problems: Problem[] = [
  {
    id: "case_mansion_01",
    title: "練習：マンションと棟・号室（ミニ）",
    text: `
マンションの物件 {{obj:マンションA|class:マンション}} には複数の棟 {{obj:1号棟|class:棟}} があり、
各棟には複数の号室があります。物件の所在地は {{slot:所在地|value:東京都新宿区|of:マンションA}}、
販売価格は {{slot:販売価格|value:120000000|of:1号棟}} のように与えられます。
`
  },

  // ★本番課題（あなたの文章を色分けタグで注釈済みの版に差し替えてOK）
  {
  id: "case_estate_real_01",
  title: "本番：不動産販売の状況からモデル化する",
  text: `
長野市松代町東条 1-2-3 にある {{obj:棟A|class:棟}} では、
{{obj:502号室|class:号室}}（{{slot:販売価格|value:29800000|of:502号室}}、{{slot:階|value:5|of:502号室}}）と、
{{obj:1203号室|class:号室}}（{{slot:販売価格|value:41500000|of:1203号室}}、{{slot:階|value:12|of:1203号室}}）が売り出し中で、
どちらも {{rel: 502号室->棟A | label: 帰属}} {{rel: 1203号室->棟A | label: 帰属}} に帰属している。
別に、長野市川中島町原 45-6 の {{obj:戸建てX|class:物件}}（{{slot:販売価格|value:32800000|of:戸建てX}}）も売り出し中である。
建物の棟の名称は「棟A」である。所在地は {{slot:所在地|value:長野市松代町東条1-2-3|of:棟A}} および
{{slot:所在地|value:長野市川中島町原45-6|of:戸建てX}} と記録する。
`
},
];
