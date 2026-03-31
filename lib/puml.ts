// /lib/puml.ts
import { v4 as uuid } from "uuid";
import type { Obj, Attr } from "@/types/domain";

/**
 * PlantUML object {...} → Obj[] 変換（日本語名 / "引用名" / :型 / 日本語属性キー対応）
 */
export function parsePumlToObjs(text: string): Obj[] {
  const out: Obj[] = [];
  // object ヘッダー + 本文を取得（Unicode対応）
  const re = /object\s+([^{]+?)\s*\{([\s\S]*?)\}/giu;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const header = (m[1] || "").trim();
    const body = m[2] || "";

    // 1) "引用名" > 2) as/ : の左側 > 3) header先頭
    let name = "";
    const quoted = header.match(/"([^"]+)"/);
    if (quoted) {
      name = quoted[1].trim();
    } else {
      const split = header.split(/\s+(?:as|:)\s+/i);
      name = (split[0] || header).trim();
    }

    const attrs: Attr[] = [];
    const lines = body
      .split(/\r?\n|;/)
      .map((s) => s.replace(/^\s*'.*$/, "").replace(/^\s*\/\/.*$/, "")) // コメント除去
      .map((s) => s.trim())
      .filter(Boolean);

    for (const ln of lines) {
      const eq = ln.indexOf("=");
      if (eq > 0) {
        const key = ln.slice(0, eq).trim();       // 日本語キーOK
        const value = ln.slice(eq + 1).trim();
        attrs.push({ key, value });
      }
    }

    out.push({
      id: uuid(),
      name,
      source: "user",
      attrs: (attrs.length ? attrs : [{ key: "", value: "" }]).map(a => ({ ...a, source: "user" })),
    });
    
    if (name) {
      out.push({ id: uuid(), name, attrs: attrs.length ? attrs : [{ key: "", value: "" }] });
    }
  }
  return out;
}

