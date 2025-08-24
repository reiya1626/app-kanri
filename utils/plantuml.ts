import plantumlEncoder from "plantuml-encoder";

export function generatePlantUMLUrl(umlCode: string): string {
  const encoded = plantumlEncoder.encode(umlCode); // 正しい deflate + PlantUMLエンコード
  return `https://www.plantuml.com/plantuml/svg/${encoded}`;
}