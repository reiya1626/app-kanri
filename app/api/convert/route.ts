import { NextRequest, NextResponse } from "next/server";
import plantumlEncoder from "plantuml-encoder";

/**
 * 変換API
 * - オブジェクト図（objects + links）から推定クラス図の PlantUML を生成
 * - クラス抽出ルール（教育向け簡易版）:
 *   - 属性なしオブジェクト … baseName(name) をそのままクラス名として採用
 *   - 属性ありオブジェクト … 属性キー集合でクラスタリング
 *       - 同じ属性パターンのオブジェクトが2つ以上 → 同じ「クラス名未定X」にまとめる
 *       - 1つだけのもの → 単独でも「クラス名未定X」としてクラス候補にする
 * - 型集合を保持して <!> / <?> を属性に付与
 * - クラスタ単位で <<incomplete>> / <<contradictory>> をクラスに付与
 * - 関連は“弱い観測/曖昧”を点線（..）で出力
 * - 多重度は OD だけでは断定しにくいので、変換結果の多重度は原則 0..* とする
 *   （OD観測値は multiplicityHints で別返し）
 * - 明示リンクに label があれば、それを関連名として採用（多数決で1つに絞る）
 * - さらに、クラス対ごとのラベル候補一覧 relationHints も返す
 * - 継承候補は「共通属性があり、かつ双方に固有属性がある」組合せを提示する
 *   - 共通属性が2個以上 → 有力候補
 *   - 共通属性が1個 → 参考候補
 *   - 親クラス名は自動確定せず、suggestedParentName は補助候補のみ返す
 */

type PrimType = "int" | "real" | "boolean" | "string";

type AttrIn = { key: string; value: string };
type ObjIn = { name: string; attrs: AttrIn[] };

type LinkIn = { from: string; to: string; label?: string };

type InputPayload = {
  objects: ObjIn[];
  links?: LinkIn[];
};

type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};

/**
 * 多重度ヒント（OD観測値）
 * - 変換結果（PlantUML）では断定的な多重度を置かず、基本は 0..* を採用
 * - 代わりに「各インスタンスが持つ接続数（観測）」を返して、編集画面で根拠として提示できるようにする
 */
type MultiplicityHint = {
  /** "A--B"（クラス名を辞書順で並べたキー） */
  key: string;
  /** 辞書順で小さい方 */
  a: string;
  /** 辞書順で大きい方 */
  b: string;
  /** Aクラス各インスタンスがBへ持つリンク本数（OD観測） */
  aToBCounts: number[];
  /** Bクラス各インスタンスがAへ持つリンク本数（OD観測） */
  bToACounts: number[];
  /** サマリ（表示用） */
  aToBMin: number;
  aToBMax: number;
  bToAMin: number;
  bToAMax: number;
};

type InheritanceCandidateStrength = "strong" | "weak";

type InheritanceCandidate = {
  key: string;
  children: [string, string];
  sharedAttrs: string[];
  childSpecificAttrs: Record<string, string[]>;
  sharedCount: number;
  strength: InheritanceCandidateStrength;
  score: number;
  suggestedParentName?: string;
  explanationFacts: string[];
  explanationSummary: string;
};

// ===== ユーティリティ =====

const detectType = (v: string): PrimType => {
  const t = v.trim().replace(/^[[\s\n\r\t"']+|[\s\n\r\t"']+$/g, "");
  if (/^-?\d+$/.test(t)) return "int";
  if (/^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t)) return "real";
  if (/^(?:true|false)$/i.test(t)) return "boolean";
  return "string";
};

/** 末尾の連番を落としたベース名（例：商品1, 商品02 → 商品） */
const baseName = (s: string): string => s.trim().replace(/\d+$/g, "");

/** 属性キーの正規化（空白・全角半角の差を吸収、lower化） */
const normKey = (s: string): string =>
  s.replace(/\s+/g, " ").trim().toLowerCase();

/** [a,b,c] 形式（軽量パーサ）。かっこ無しは単一要素扱い */
const tokenizeList = (raw: string): string[] => {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1);
    return inner
      .split(/[,、]\s*/)
      .map((x) => x.replace(/^['"]|['"]$/g, "").trim())
      .filter(Boolean);
  }
  return [t.replace(/^['"]|['"]$/g, "").trim()];
};

/** PlantUML安全用：ダブルクオートをエスケープ */
const esc = (s: string) => s.replace(/"/g, '\\"');

const uniqueSorted = (values: string[]) => Array.from(new Set(values)).sort();

const title = (strength: InheritanceCandidateStrength) =>
  strength === "strong" ? "有力候補" : "参考候補";

const longestCommonSuffix = (a: string, b: string): string => {
  const aa = a.trim();
  const bb = b.trim();
  let i = 0;
  while (
    i < aa.length &&
    i < bb.length &&
    aa.charAt(aa.length - 1 - i) === bb.charAt(bb.length - 1 - i)
  ) {
    i += 1;
  }
  return i > 0 ? aa.slice(aa.length - i).trim() : "";
};

const pickSuggestedParentName = (a: string, b: string): string | undefined => {
  const suffix = longestCommonSuffix(a, b);
  if (suffix && suffix.length >= 2) return suffix;
  return undefined;
};

function buildInheritanceCandidates(classAttrMap: Map<string, string[]>) {
  const classNames = Array.from(classAttrMap.keys()).sort();
  const results: InheritanceCandidate[] = [];

  for (let i = 0; i < classNames.length; i += 1) {
    for (let j = i + 1; j < classNames.length; j += 1) {
      const a = classNames[i];
      const b = classNames[j];
      const attrsA = uniqueSorted(classAttrMap.get(a) ?? []);
      const attrsB = uniqueSorted(classAttrMap.get(b) ?? []);

      if (attrsA.length === 0 || attrsB.length === 0) continue;

      const setA = new Set(attrsA);
      const setB = new Set(attrsB);

      const sharedAttrs = attrsA.filter((k) => setB.has(k));
      const onlyA = attrsA.filter((k) => !setB.has(k));
      const onlyB = attrsB.filter((k) => !setA.has(k));

      // 教育向けルール:
      // - 共通属性が1個以上ある
      // - 双方に固有属性が1個以上ある
      if (sharedAttrs.length < 1) continue;
      if (onlyA.length < 1 || onlyB.length < 1) continue;

      const denom = Math.max(attrsA.length, attrsB.length, 1);
      const score = Number((sharedAttrs.length / denom).toFixed(2));
      const strength: InheritanceCandidateStrength =
        sharedAttrs.length >= 2 ? "strong" : "weak";

      const suggestedParentName = pickSuggestedParentName(a, b);
      const explanationFacts = [
        `${a} と ${b} は共通して「${sharedAttrs.join("」「")}」を持っています。`,
        `${a} には「${onlyA.join("」「")}」があります。`,
        `${b} には「${onlyB.join("」「")}」があります。`,
      ];

      const explanationSummary =
        strength === "strong"
          ? `複数の共通属性があり、かつ両クラスに固有属性もあるため、共通部分を親クラスにまとめる継承関係の${title(
              strength
            )}です。`
          : `共通属性はありますが数は多くないため、継承関係の${title(
              strength
            )}として提示しています。親クラスにまとめるかは設計上の検討が必要です。`;

      results.push({
        key: `${a}::${b}`,
        children: [a, b],
        sharedAttrs,
        childSpecificAttrs: {
          [a]: onlyA,
          [b]: onlyB,
        },
        sharedCount: sharedAttrs.length,
        strength,
        score,
        suggestedParentName,
        explanationFacts,
        explanationSummary,
      });
    }
  }

  return results.sort((x, y) => {
    if (x.strength !== y.strength) return x.strength === "strong" ? -1 : 1;
    if (y.sharedCount !== x.sharedCount) return y.sharedCount - x.sharedCount;
    if (y.score !== x.score) return y.score - x.score;
    return x.key.localeCompare(y.key, "ja");
  });
}

// ====== ルート本体 ======
export async function POST(req: NextRequest) {
  let payload: InputPayload;
  try {
    payload = (await req.json()) as InputPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  const links = Array.isArray(payload.links) ? payload.links! : [];

  // --- オブジェクトの前処理 ---
  type ObjInfo = {
    obj: ObjIn;
    base: string; // baseName(name) or name
    attrKeys: string[]; // 正規化した属性キーのソート済み集合
    hasAttrs: boolean;
  };

  const objInfos: ObjInfo[] = objects.map((o) => {
    const base = baseName(o.name) || o.name;
    const keySet = new Set<string>();
    for (const a of o.attrs ?? []) {
      const k = normKey(a.key);
      if (k) keySet.add(k);
    }
    const attrKeys = Array.from(keySet.values()).sort();
    const hasAttrs = attrKeys.length > 0;
    return { obj: o, base, attrKeys, hasAttrs };
  });

  // --- オブジェクト → クラス（教育向け簡易クラス抽出） ---
  const obj2class = new Map<string, string>();
  const classNames: string[] = [];

  const addClassName = (name: string) => {
    if (!classNames.includes(name)) classNames.push(name);
  };

  // 1) 属性なしオブジェクトは、そのままクラス候補とする
  //    → 「文学」「経済学」などは baseName でそのままクラスに
  for (const info of objInfos.filter((i) => !i.hasAttrs)) {
    const className = info.base || info.obj.name;
    addClassName(className);
    obj2class.set(info.obj.name, className);
  }

  // 2) 属性ありオブジェクトは baseName ではグルーピングせず、
  //    属性キー集合（attrKeys）のパターンでクラスタリングする
  const attrFullInfos = objInfos.filter((i) => i.hasAttrs);

  const patternGroups = new Map<string, ObjInfo[]>();
  for (const info of attrFullInfos) {
    const patternKey =
      info.attrKeys.length > 0 ? info.attrKeys.join("|") : "(none)";
    if (!patternGroups.has(patternKey)) patternGroups.set(patternKey, []);
    patternGroups.get(patternKey)!.push(info);
  }

  // 属性パターングループごとにクラスを付与
  // - 同じパターンで2件以上 → 同じクラス名未定X にまとめる
  // - 1件だけ → それもクラス名未定X（＝すべて「命名対象」になる）
  let unnamedIndex = 1;

  for (const [, group] of patternGroups.entries()) {
    const className = `クラス名未定${unnamedIndex++}`;
    addClassName(className);
    for (const info of group) {
      obj2class.set(info.obj.name, className);
    }
  }

  // 最終的なクラス一覧
  const classes = classNames.map((name) => ({ name }));

  // クラス→インスタンス名（OD観測の集計に使う）
  const classMembers = new Map<string, string[]>();
  for (const o of objects) {
    const c = obj2class.get(o.name);
    if (!c) continue;
    if (!classMembers.has(c)) classMembers.set(c, []);
    classMembers.get(c)!.push(o.name);
  }

  // --- 型集合と“空値観測”を保持 ---
  const typeSets = new Map<string, Map<string, Set<PrimType>>>(); // class -> key -> set(types)
  const emptySeen = new Map<string, Map<string, boolean>>(); // class -> key -> seenEmpty

  for (const c of classes) {
    typeSets.set(c.name, new Map());
    emptySeen.set(c.name, new Map());
  }

  // 属性から型集合を構築
  for (const o of objects) {
    const c = obj2class.get(o.name);
    if (!c) continue; // 念のため
    const tmap = typeSets.get(c)!;
    const emap = emptySeen.get(c)!;

    for (const a of o.attrs ?? []) {
      const k = normKey(a.key);
      if (!k) continue;

      if (!tmap.has(k)) tmap.set(k, new Set());
      if (!emap.has(k)) emap.set(k, false);

      const raw = (a.value ?? "").trim();
      if (!raw) {
        emap.set(k, true);
        continue;
      }

      const values = tokenizeList(raw);
      for (const one of values) {
        tmap.get(k)!.add(detectType(one));
      }
    }
  }

  // 継承候補用: クラスごとの属性一覧を作る
  const classAttrMap = new Map<string, string[]>();
  for (const c of classes) {
    const attrKeys = Array.from((typeSets.get(c.name) ?? new Map()).keys()).sort();
    classAttrMap.set(c.name, attrKeys);
  }

  const inheritanceCandidates = buildInheritanceCandidates(classAttrMap);

  // --- 参照（関連）観測 ---
  // NOTE:
  // - relationHints は従来どおり「A::B（向き付き）」で保持
  // - 多重度ヒントは「A--B（無向）」で保持（クラス名を辞書順で並べる）
  const assocLabelCount = new Map<string, Map<string, number>>(); // key: "A::B" → label -> count

  // 多重度ヒント用の集計（無向）
  type PairAgg = {
    a: string;
    b: string;
    // instanceName -> count
    aCounts: Map<string, number>;
    bCounts: Map<string, number>;
    labelCounts: Map<string, number>;
    total: number;
  };
  const pairAgg = new Map<string, PairAgg>(); // key: "A--B"

  const getPairKey = (c1: string, c2: string) =>
    c1 <= c2 ? `${c1}--${c2}` : `${c2}--${c1}`;

  const getOrCreatePair = (c1: string, c2: string) => {
    const key = getPairKey(c1, c2);
    let agg = pairAgg.get(key);
    if (!agg) {
      const a = c1 <= c2 ? c1 : c2;
      const b = c1 <= c2 ? c2 : c1;
      agg = {
        a,
        b,
        aCounts: new Map(),
        bCounts: new Map(),
        labelCounts: new Map(),
        total: 0,
      };
      pairAgg.set(key, agg);
    }
    return agg;
  };

  const addPairObservation = (
    classFrom: string,
    classTo: string,
    fromInstance: string,
    toInstance: string,
    rawLabel?: string
  ) => {
    const agg = getOrCreatePair(classFrom, classTo);
    agg.total += 1;

    // どちらが agg.a / agg.b かでカウント先を分ける
    if (classFrom === agg.a && classTo === agg.b) {
      agg.aCounts.set(fromInstance, (agg.aCounts.get(fromInstance) ?? 0) + 1);
      agg.bCounts.set(toInstance, (agg.bCounts.get(toInstance) ?? 0) + 1);
    } else if (classFrom === agg.b && classTo === agg.a) {
      agg.aCounts.set(toInstance, (agg.aCounts.get(toInstance) ?? 0) + 1);
      agg.bCounts.set(fromInstance, (agg.bCounts.get(fromInstance) ?? 0) + 1);
    } else {
      // 同一クラス（自己関連）など
      // agg.a === agg.b の場合、両方 aCounts に積む
      agg.aCounts.set(fromInstance, (agg.aCounts.get(fromInstance) ?? 0) + 1);
      agg.bCounts.set(toInstance, (agg.bCounts.get(toInstance) ?? 0) + 1);
    }

    const lbl = (rawLabel ?? "").trim();
    if (lbl) agg.labelCounts.set(lbl, (agg.labelCounts.get(lbl) ?? 0) + 1);
  };

  const countLabel = (key: string, rawLabel?: string) => {
    const lbl = (rawLabel ?? "").trim();
    if (!lbl) return;
    let m = assocLabelCount.get(key);
    if (!m) {
      m = new Map<string, number>();
      assocLabelCount.set(key, m);
    }
    m.set(lbl, (m.get(lbl) ?? 0) + 1);
  };

  // 1) 明示リンクを採用（＆ label も記録）
  for (const l of links) {
    const a = obj2class.get(l.from);
    const b = obj2class.get(l.to);
    if (!a || !b) continue;
    // relationHints 用（向き付き）
    countLabel(`${a}::${b}`, l.label);

    // 多重度ヒント用（無向）
    addPairObservation(a, b, l.from, l.to, l.label);
  }

  // 2) 属性値が他オブジェクト名に一致する場合を参照としてカウント
  //    （こちらは label を持たない）
  const nameSet = new Set(objects.map((o) => o.name));
  for (const o of objects) {
    const aClass = obj2class.get(o.name);
    if (!aClass) continue;

    for (const a of o.attrs ?? []) {
      const raw = (a.value ?? "").trim();
      if (!raw) continue;
      const values = tokenizeList(raw);
      for (const v of values) {
        if (nameSet.has(v)) {
          const bClass = obj2class.get(v);
          if (!bClass) continue;

          // 多重度ヒント用（無向）
          addPairObservation(aClass, bClass, o.name, v, undefined);
        }
      }
    }
  }

  // ===== relationHints を作成（クラス対ごとのラベル候補一覧） =====
  const relationHints: RelationHint[] = [];
  for (const [key, labelMap] of assocLabelCount.entries()) {
    const [fromClass, toClass] = key.split("::");
    const candidates = Array.from(labelMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count); // 出現回数の多い順
    if (candidates.length > 0) {
      relationHints.push({ fromClass, toClass, candidates });
    }
  }

  // ===== multiplicityHints（OD観測）を作成 =====
  const multiplicityHints: MultiplicityHint[] = [];

  const calcMinMax = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0 };
    let min = arr[0];
    let max = arr[0];
    for (const n of arr) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
    return { min, max };
  };

  for (const agg of pairAgg.values()) {
    const aMembers = classMembers.get(agg.a) ?? [];
    const bMembers = classMembers.get(agg.b) ?? [];

    const aToBCounts = aMembers.map((inst) => agg.aCounts.get(inst) ?? 0);
    const bToACounts = bMembers.map((inst) => agg.bCounts.get(inst) ?? 0);

    const aMM = calcMinMax(aToBCounts);
    const bMM = calcMinMax(bToACounts);

    multiplicityHints.push({
      key: `${agg.a}--${agg.b}`,
      a: agg.a,
      b: agg.b,
      aToBCounts,
      bToACounts,
      aToBMin: aMM.min,
      aToBMax: aMM.max,
      bToAMin: bMM.min,
      bToAMax: bMM.max,
    });
  }

  // ===== PlantUML 出力 =====
  let puml = "@startuml\n";
  puml += "hide empty members\n";
  puml += "skinparam classAttributeIconSize 0\n";
  puml += "skinparam class {\n";
  puml += "  BackgroundColor<<incomplete>> #fffbe6\n"; // 薄黄
  puml += "  BackgroundColor<<contradictory>> #ffecec\n"; // 薄赤
  puml += "  BorderColor<<contradictory>> #ff6666\n";
  puml += "}\n";

  // --- クラス定義 ---
  for (const c of classes) {
    const tmap = typeSets.get(c.name)!;
    const emap = emptySeen.get(c.name)!;

    let hasContradiction = false;
    let hasIncomplete = false;

    let body = "";
    for (const [k, setTypes] of tmap.entries()) {
      const types = Array.from(setTypes.values());
      let mark = "";
      if (types.length === 0 && (emap.get(k) ?? false)) {
        mark = "<?>"; // 値が観測されていない
        hasIncomplete = true;
      } else if (types.length > 1) {
        mark = "<!>"; // 型が混在
        hasContradiction = true;
      }
      const showType: PrimType = types[0] ?? "string";
      body += `  ${esc(k)}: ${showType} ${mark}\n`;
    }

    const stereo = hasContradiction
      ? " <<contradictory>>"
      : hasIncomplete
      ? " <<incomplete>>"
      : "";
    puml += `class ${esc(c.name)}${stereo} {\n${body}}\n`;
  }

  // --- 関連（点線 or 実線 + ラベル） ---
  // ODのみから断定的な多重度（特に下限/上限）を置くとミスリードになりやすいので、
  // 変換結果では原則 0..* を採用する。
  // （観測値は multiplicityHints として別返し）
  // ラベル：明示リンクで観測された label のうち、最多のものを1つ採用
  // 関連は「無向のクラス対」ごとに 1 本だけ出力する（A--B）
  const pairKeys = Array.from(pairAgg.keys()).sort();
  for (const pairKey of pairKeys) {
    const agg = pairAgg.get(pairKey);
    if (!agg) continue;

    const a = agg.a;
    const b = agg.b;

    // 観測が少ないときは点線（不確か）
    const style = agg.total <= 1 ? ".." : "--";

    // ODのみから断定しない（下限/上限とも）
    const multLeft = "0..*";
    const multRight = "0..*";

    // ラベル多数決
    let labelPart = "";
    if (agg.labelCounts.size > 0) {
      let bestLabel = "";
      let bestCount = 0;
      for (const [lab, cnt] of agg.labelCounts.entries()) {
        if (cnt > bestCount) {
          bestLabel = lab;
          bestCount = cnt;
        }
      }
      if (bestLabel) labelPart = ` : ${esc(bestLabel)}`;
    }

    puml += `${esc(a)} "${multLeft}" ${style} "${multRight}" ${esc(b)}${labelPart}\n`;
  }

  puml += "@enduml";

  const encoded = plantumlEncoder.encode(puml);
  const issues = summarizeIssues(typeSets, emptySeen);

  return NextResponse.json({
    classPuml: puml,
    encodedPuml: encoded,
    issues,
    relationHints,
    multiplicityHints,
    inheritanceCandidates,
  });
}

// ===== Issues のダイジェスト（UI の Evidence 用） =====
function summarizeIssues(
  typeSets: Map<string, Map<string, Set<PrimType>>>,
  emptySeen: Map<string, Map<string, boolean>>
) {
  const classes: Array<{
    name: string;
    incomplete: string[];
    contradictory: string[];
  }> = [];
  for (const [cname, tmap] of typeSets) {
    const emap = emptySeen.get(cname) || new Map<string, boolean>();
    const incomplete: string[] = [];
    const contradictory: string[] = [];

    for (const [k, setTypes] of tmap.entries()) {
      const types = Array.from(setTypes.values());
      if (types.length === 0 && (emap.get(k) ?? false)) incomplete.push(k);
      else if (types.length > 1)
        contradictory.push(`${k} [${types.join(", ")}]`);
    }

    if (incomplete.length || contradictory.length) {
      classes.push({ name: cname, incomplete, contradictory });
    }
  }
  return { classes };
}