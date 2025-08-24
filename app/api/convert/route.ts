import { NextRequest, NextResponse } from "next/server";
import plantumlEncoder from "plantuml-encoder";

/**
 * 変換API（全面差し替え版）
 * - 型集合を保持して <!> / <?> を属性に付与
 * - クラスタ単位で <<incomplete>> / <<contradictory>> をクラスに付与
 * - 関連は“弱い観測/曖昧”を点線（..）で出力
 * - 多重度は簡易（0..1 / 0..*）を右側に表示
 *
 * 期待する入力JSON（最低限）
 * {
 *   "objects": [
 *     { "name": "商品1", "attrs": [{"key":"価格","value":"1200"}, ...] },
 *     { "name": "会計1", "attrs": [{"key":"対象","value":"商品1"}, ...] }
 *   ],
 *   "links": [ // 任意（明示リンクがあれば参照として採用）
 *     { "from": "会計1", "to": "商品1", "label": "対象" }
 *   ]
 * }
 */

// ===== 型定義 =====
type PrimType = "int" | "real" | "boolean" | "string";

type AttrIn = { key: string; value: string };
type ObjIn  = { name: string; attrs: AttrIn[] };

type LinkIn = { from: string; to: string; label?: string };

type InputPayload = {
  objects: ObjIn[];
  links?: LinkIn[];
};

// ===== ユーティリティ =====
const detectType = (v: string): PrimType => {
  const t = v.trim().replace(/^[[\s\n\r\t\"\']+|[\s\n\r\t\"\']+$/g, "");
  if (/^-?\d+$/.test(t)) return "int";
  if (/^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t)) return "real";
  if (/^(?:true|false)$/i.test(t)) return "boolean";
  return "string";
};

/** 末尾の連番を落としたベース名（例：商品1, 商品02 → 商品） */
const baseName = (s: string): string => s.trim().replace(/\d+$/g, "");

/** 属性キーの正規化（空白・全角半角の差を吸収、lower化） */
const normKey = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** [a,b,c] 形式（軽量パーサ）。かっこ無しは単一要素扱い */
const tokenizeList = (raw: string): string[] => {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1);
    return inner
      .split(/[,、]\s*/)
      .map(x => x.replace(/^['\"]|['\"]$/g, "").trim())
      .filter(Boolean);
  }
  return [t.replace(/^['\"]|['\"]$/g, "").trim()];
};

/** PlantUML安全用：ダブルクオートをエスケープ */
const esc = (s: string) => s.replace(/"/g, '\\"');

// ====== ルート本体 ======
export async function POST(req: NextRequest) {
  let payload: InputPayload;
  try {
    payload = (await req.json()) as InputPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  const links   = Array.isArray(payload.links) ? payload.links! : [];

  // --- オブジェクト名 → インデックス ---
  const byName = new Map<string, ObjIn>();
  for (const o of objects) byName.set(o.name, o);

  // --- オブジェクト → クラス（ベース名でクラスタリング） ---
  const obj2class = new Map<string, string>();
  const classesSet = new Set<string>();
  for (const o of objects) {
    const c = baseName(o.name) || o.name;
    obj2class.set(o.name, c);
    classesSet.add(c);
  }
  const classes = Array.from(classesSet).map(name => ({ name }));

  // --- 型集合と“空値観測”を保持 ---
  const typeSets = new Map<string, Map<string, Set<PrimType>>>(); // class -> key -> set(types)
  const emptySeen = new Map<string, Map<string, boolean>>();       // class -> key -> seenEmpty

  // クラスごとの初期化
  for (const c of classes) {
    typeSets.set(c.name, new Map());
    emptySeen.set(c.name, new Map());
  }

  // 属性から型集合を構築
  for (const o of objects) {
    const c = obj2class.get(o.name)!;
    const tmap = typeSets.get(c)!;
    const emap = emptySeen.get(c)!;

    for (const a of o.attrs ?? []) {
      const k = normKey(a.key);
      if (!tmap.has(k)) tmap.set(k, new Set());
      if (!emap.has(k)) emap.set(k, false);

      const raw = (a.value ?? "").trim();
      if (!raw) { emap.set(k, true); continue; }

      const values = tokenizeList(raw);
      for (const one of values) tmap.get(k)!.add(detectType(one));
    }
  }

  // --- 参照（関連）観測 ---
  // クラス対ごとに観測数（上限計算のため）
  const assocCount = new Map<string, number>(); // key: "A::B" → total occurrences
  const assocMulti = new Map<string, number>(); // key: "A::B" → max occurrences per (A-instance)

  // 1) 明示リンクを採用
  for (const l of links) {
    const a = obj2class.get(l.from);
    const b = obj2class.get(l.to);
    if (!a || !b) continue;
    const key = `${a}::${b}`;
    assocCount.set(key, (assocCount.get(key) ?? 0) + 1);
    // 明示リンクは1つ/objとみなす
    assocMulti.set(key, Math.max(assocMulti.get(key) ?? 0, 1));
  }

  // 2) 属性値が他オブジェクト名に一致する場合を参照としてカウント
  const nameSet = new Set(objects.map(o => o.name));
  for (const o of objects) {
    const aClass = obj2class.get(o.name)!;
    const perTargetCount = new Map<string, number>(); // B-class -> count from this A-obj

    for (const a of o.attrs ?? []) {
      const raw = (a.value ?? "").trim();
      if (!raw) continue;
      const values = tokenizeList(raw);
      for (const v of values) {
        if (nameSet.has(v)) {
          const bClass = obj2class.get(v)!;
          const key = `${aClass}::${bClass}`;
          assocCount.set(key, (assocCount.get(key) ?? 0) + 1);
          perTargetCount.set(bClass, (perTargetCount.get(bClass) ?? 0) + 1);
        }
      }
    }

    // この A-instance から B-class への最大出現数（多重度判断に使う）
    for (const [bClass, cnt] of perTargetCount) {
      const key = `${aClass}::${bClass}`;
      assocMulti.set(key, Math.max(assocMulti.get(key) ?? 0, cnt));
    }
  }

  // ===== PlantUML 出力 =====
  let puml = "@startuml\n";
  puml += "hide empty members\n";
  puml += "skinparam classAttributeIconSize 0\n";
  puml += "skinparam class {\n";
  puml += "  BackgroundColor<<incomplete>> #fffbe6\n";    // 薄黄
  puml += "  BackgroundColor<<contradictory>> #ffecec\n"; // 薄赤
  puml += "  BorderColor<<contradictory>> #ff6666\n";
  puml += "}\n";

  // --- クラス定義 ---
  for (const c of classes) {
    const tmap = typeSets.get(c.name)!;
    const emap = emptySeen.get(c.name)!;

    let hasContradiction = false;
    let hasIncomplete = false;

    // 属性行を構築
    let body = "";
    for (const [k, setTypes] of tmap.entries()) {
      const types = Array.from(setTypes.values());
      let mark = "";
      if (types.length === 0 && (emap.get(k) ?? false)) {
        mark = "<?>"; hasIncomplete = true;
      } else if (types.length > 1) {
        mark = "<!>"; hasContradiction = true;
      }
      const showType: PrimType = (types[0] ?? "string");
      body += `  ${esc(k)}: ${showType} ${mark}\n`;
    }

    const stereo = hasContradiction ? " <<contradictory>>" : (hasIncomplete ? " <<incomplete>>" : "");
    puml += `class ${esc(c.name)}${stereo} {\n${body}}\n`;
  }

  // --- 関連（点線 or 実線） ---
  // 簡易規則：
  //  - 観測回数が少ない（<=1）→ “不確か” とみなし点線 ..
  //  - A-instance→B-class の最大多重が >1 → 右側多重 0..*
  //  - それ以外は 0..1
  for (const [key, total] of assocCount.entries()) {
    const [a, b] = key.split("::");
    const maxPerA = assocMulti.get(key) ?? 0;
    const dotted = total <= 1; // 観測が弱い→点線
    const style = dotted ? ".." : "--";
    const multRight = maxPerA > 1 ? "0..*" : "0..1";
    // 左側は簡易に "1" を表示（Aから見て1基点）。必要なら両側多重の推定に拡張可。
    puml += `${esc(a)} "1" ${style} "${multRight}" ${esc(b)}\n`;
  }

  puml += "@enduml";

  const encoded = plantumlEncoder.encode(puml);

  // 任意：フロントで活用しやすい“問題点ダイジェスト”
  const issues = summarizeIssues(typeSets, emptySeen);

  return NextResponse.json({
    classPuml: puml,
    encodedPuml: encoded,
    issues,
  });
}

// ===== Issues のダイジェスト（UIのEvidence用。任意） =====
function summarizeIssues(
  typeSets: Map<string, Map<string, Set<PrimType>>>,
  emptySeen: Map<string, Map<string, boolean>>,
) {
  const classes: Array<{ name: string; incomplete: string[]; contradictory: string[] }> = [];
  for (const [cname, tmap] of typeSets) {
    const emap = emptySeen.get(cname) || new Map<string, boolean>();
    const incomplete: string[] = [];
    const contradictory: string[] = [];

    for (const [k, setTypes] of tmap.entries()) {
      const types = Array.from(setTypes.values());
      if (types.length === 0 && (emap.get(k) ?? false)) incomplete.push(k);
      else if (types.length > 1) contradictory.push(`${k} [${types.join(", ")}]`);
    }

    if (incomplete.length || contradictory.length) {
      classes.push({ name: cname, incomplete, contradictory });
    }
  }
  return { classes };
}
