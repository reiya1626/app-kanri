// types/plantuml-encoder.d.ts
declare module "plantuml-encoder" {
  // ライブラリの実装は文字列→文字列のエンコード/デコードです。
  // 引数は string で十分（必要に応じて ArrayBufferLike などに拡張してOK）
  export function encode(puml: string): string;
  export function decode(data: string): string;
}
