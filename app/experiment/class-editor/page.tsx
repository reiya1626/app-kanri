// app/experiment/class-editor/page.tsx
"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../../components/problem-config";

// ===== 型定義 =====
type ClassAttr = {
  id: string;
  name: string;
  type: string;
};

type ClassInfo = {
  id: string;
  name: string;
  attrs: ClassAttr[];
};

type Relation = {
  id: string;
  fromClassId: string;
  toClassId: string;
  label: string;
  leftMultiplicity: string;
  rightMultiplicity: string;
};

type EditorInitialPayload = {
  initialClassPuml?: string;
};

// OD→CD 連携用（ODページから渡されるpayloadに合わせる）
type Slot = { key: string; value: string };
type Obj = { id: string; name: string; slots: Slot[] };
type Link = { id: string; from: string; to: string; label: string };
type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};
type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  snapshot?: { objects: Obj[]; links: Link[] };
};

type MergeSuggestion = {
  id: string;
  classIds: string[];
  title: string;
  reasons: string[];
};

// ===== 定数 =====
const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// 文字列エスケープ
const esc = (s: string) => s.replace(/\"/g, '\\"');

// 正規表現用エスケープ
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===== 問題文ハイライト用（部分一致の強化：末尾の識別子だけ落とす） =====
// 例）利用者B -> 利用者 / 学生1 -> 学生
// ※ 何でも部分一致にすると誤検出が増えるため、「末尾の識別子っぽいもの」だけを控えめに除去する
const baseNameForProblemHighlight = (raw: string) => {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  // 末尾の区切り（先に除去）
  s = s.replace(/[_\-\s]+$/g, "").trim();

  // 末尾の連番（半角/全角）
  s = s.replace(/[0-9]+$/g, "");
  s = s.replace(/[０-９]+$/g, "");

  // 末尾の英字+連番（例：UserA1）
  s = s.replace(/[A-Za-z]+[0-9]+$/g, "");
  s = s.replace(/[Ａ-Ｚａ-ｚ]+[0-9]+$/g, "");
  s = s.replace(/[Ａ-Ｚａ-ｚ]+[０-９]+$/g, "");

  // 末尾の英字 1 文字（例：利用者B）
  if (/[A-Za-zＡ-Ｚａ-ｚ]$/.test(s)) {
    const head = s.slice(0, -1);
    // 「日本語を含む名前」に対してのみ落とす（UserB のような英字のみは温存）
    if (/[ぁ-んァ-ン一-龥ー]/.test(head)) s = head;
  }

  return s.trim();
};

// 軽い正規化（比較用）
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ===== OD→CD 連携: 文字正規化（OD側と同じ思想） =====
const stripHtmlTags = (s: string) => (s ?? "").replace(/<[^>]*>/g, "");

const normalizeObjectLabel = (raw: string) => {
  const noTags = stripHtmlTags(raw).trim();
  const left = noTags.includes(":") ? noTags.split(":")[0].trim() : noTags;
  return left.replace(/^\"+|\"+$/g, "").trim();
};

// 末尾番号などを落としてベース名化（例：学生1→学生）
const baseNameForAssist = (name: string) => {
  let s = normalizeObjectLabel(name);
  s = s.replace(/[0-9]+$/g, "");
  s = s.replace(/[０-９]+$/g, "");
  s = s.replace(/[A-Za-z]+[0-9]+$/g, "");
  s = s.replace(/[_\-\s]+$/g, "");
  return s.trim();
};

const normalizeLinkLabel = (raw: string) => {
  const t = stripHtmlTags(raw ?? "")
    .trim()
    .replace(/^\"+|\"+$/g, "")
    .replace(/\s+/g, "");
  return t;
};

const makeEndpointKey = (aBase: string, bBase: string) => {
  const x = aBase <= bBase ? aBase : bBase;
  const y = aBase <= bBase ? bBase : aBase;
  return `${x}||${y}`;
};

// 正答（クラス図）PlantUML からクラス名を抽出する
// - 固定の候補語リストは使わず、教員が登録した「正答例PUML」に出てくるクラス名をそのまま候補として提示する
// - class 定義がない場合に備えて、関連行からも補助的に拾う
function extractClassNamesFromPuml(puml: string | undefined): string[] {
  if (!puml) return [];
  const names: string[] = [];
  const add = (name: string) => {
    const n = String(name ?? "").trim();
    if (!n) return;
    if (!names.includes(n)) names.push(n);
  };

  const lines = puml.split(/\r?\n/);
  for (const raw of lines) {
    // PlantUML のコメント（' から行末）を除去
    const line = raw.replace(/'.*$/, "").trim();
    if (!line) continue;

    // class 定義：class 学生 { ... } / class "学生" as S { ... } / abstract class ...
    const mClass = line.match(/^(?:abstract\s+)?class\s+(.+?)(?:\s+<<.*?>>)?\s*(?:\{|$)/i);
    if (mClass) {
      let part = mClass[1].trim();
      // "as alias" を落とす
      part = part.replace(/\s+as\s+.+$/i, "").trim();

      // "..." で囲まれている場合は中身
      const q = part.match(/^\"([^\"]+)\"$/) || part.match(/^\"([^\"]+)\"\s+/);
      if (q) {
        add(q[1]);
      } else {
        // 非クォートなら先頭トークンをクラス名として扱う（空白区切り）
        add(part.split(/\s+/)[0]);
      }
      continue;
    }

    // 関連行（クォート版）："学生" "0..*" -- "1..*" "授業" : 履修する
    const mRelQuoted = line.match(/^\"([^\"]+)\"\s+\"[^\"]*\"\s+(?:--|\.\.)\s+\"[^\"]*\"\s+\"([^\"]+)\"/);
    if (mRelQuoted) {
      add(mRelQuoted[1]);
      add(mRelQuoted[2]);
      continue;
    }

    // 関連行（非クォート版）：学生 "0..*" -- "1..*" 授業 : 履修する
    const mRel = line.match(/^(.+?)\s+\"[^\"]*\"\s+(?:--|\.\.)\s+\"[^\"]*\"\s+(.+?)(?:\s*:|$)/);
    if (mRel) {
      const a = mRel[1].trim().replace(/^\"|\"$/g, "");
      const b = mRel[2].trim().replace(/^\"|\"$/g, "");
      // a / b が多重度っぽい文字だけの場合は除外
      if (!/^[0-9*\.]+$/.test(a)) add(a);
      if (!/^[0-9*\.]+$/.test(b)) add(b);
      continue;
    }
  }
  return names;
}

// ===== PlantUML からの簡易パーサ =====
function parseInitialPuml(
  puml: string | undefined
): {
  classes: ClassInfo[];
  relations: Relation[];
} {
  if (!puml) return { classes: [], relations: [] };

  const classes: ClassInfo[] = [];
  const relations: Relation[] = [];

  const lines = puml.split(/\r?\n/);
  let currentClass: ClassInfo | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // class 行
    if (line.startsWith("class ")) {
      // 例: class 学生 <<incomplete>> {
      const m = line.match(/^class\s+(.+?)(?:\s+<<.*?>>)?\s*\{/);
      if (m) {
        const name = m[1].trim();
        const cls: ClassInfo = { id: makeId(), name, attrs: [] };
        classes.push(cls);
        currentClass = cls;
        continue;
      }
    }

    // クラスブロックの終了
    if (line === "}") {
      currentClass = null;
      continue;
    }

    // クラス内属性行
    if (currentClass) {
      // 例: 年齢: string <!>
      const mAttr = line.match(/^(.+?):\s*([a-zA-Z]+)\b/);
      if (mAttr) {
        currentClass.attrs.push({
          id: makeId(),
          name: mAttr[1].trim(),
          type: mAttr[2].trim(),
        });
      }
      continue;
    }

    // 関連行
    // 例: 学生 "1" -- "0..*" 授業 : 履修する
    const mRel = raw.match(/^(.+?)\s+\"([^\"]*)\"\s+(\.\.|--)\s+\"([^\"]*)\"\s+(.+?)(?:\s*:\s*(.+))?$/);
    if (mRel) {
      const fromName = mRel[1].trim();
      const leftMult = mRel[2].trim();
      const rightMult = mRel[4].trim();
      const toName = mRel[5].trim();
      const label = (mRel[6] || "").trim();

      relations.push({
        id: makeId(),
        fromClassId: fromName,
        toClassId: toName,
        label,
        leftMultiplicity: leftMult,
        rightMultiplicity: rightMult,
      });
    }
  }

  // クラス名を ID に解決
  for (const r of relations) {
    const fromByName = classes.find((c) => c.name === r.fromClassId);
    if (fromByName) r.fromClassId = fromByName.id;

    const toByName = classes.find((c) => c.name === r.toClassId);
    if (toByName) r.toClassId = toByName.id;
  }

  return { classes, relations };
}

// ===== フィードバック生成（簡易） =====
function makeFeedback(classes: ClassInfo[], relations: Relation[]): string[] {
  const msgs: string[] = [];

  if (classes.some((c) => c.attrs.length === 0)) {
    msgs.push(
      "属性が 1 つもないクラスがあります。クラスは「そのものが持つ情報」も表すので、必要なら属性（例：年齢、氏名 など）を追加してみましょう。"
    );
  }

  // 関連を持たないクラス
  const relatedIds = new Set<string>();
  for (const r of relations) {
    relatedIds.add(r.fromClassId);
    relatedIds.add(r.toClassId);
  }
  const isolated = classes.filter((c) => !relatedIds.has(c.id));
  if (isolated.length > 0) {
    msgs.push(
      "他のクラスとつながっていないクラスがあります。問題文で関係があるなら、関連で結んでみましょう（必要ないならそのままでもOKです）。"
    );
  }

  // 無名の関連
  if (relations.some((r) => !r.label.trim())) {
    msgs.push(
      "名前が空の関連があります。「何の関係か」が伝わるように、短い動詞（例：履修する、担当する）を付けてみましょう。"
    );
  }

  if (msgs.length === 0) {
    msgs.push(
      "今のクラス図には大きな問題は見つかりませんでした。より分かりやすい名前や属性がないか、最後に見直してみましょう。"
    );
  }

  return msgs;
}

// 問題文ハイライト用：選択語を <mark> で囲む
type HighlightToken = {
  match: string;
  reason: string;
  priority: number; // 同じmatchが複数ある場合に、優先して理由を出す
};

function highlightText(text: string, tokens: HighlightToken[]): ReactNode[] {
  if (!text) return [text];

  const cleaned = tokens
    .map((t) => ({ ...t, match: String(t.match ?? "").trim() }))
    .filter((t) => t.match.length > 0);
  if (cleaned.length === 0) return [text];

  // 同一matchは優先度の高いものを採用（理由がぶれないように）
  const normKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const bestByMatch = new Map<string, HighlightToken>();
  for (const t of cleaned) {
    const key = normKey(t.match);
    const prev = bestByMatch.get(key);
    if (!prev || t.priority > prev.priority) bestByMatch.set(key, t);
  }

  // 長い語を優先（部分一致の食い合いを減らす）
  const uniq = Array.from(bestByMatch.values()).sort((a, b) => {
    const len = b.match.length - a.match.length;
    if (len !== 0) return len;
    return b.priority - a.priority;
  });

  const pattern = uniq.map((t) => escapeRegExp(t.match)).join("|");
  if (!pattern) return [text];

  const re = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(re);

  // splitで返る文字列（実際の表記）→ token へのマップ
  const tokenMap = new Map<string, HighlightToken>();
  for (const t of uniq) tokenMap.set(normKey(t.match), t);

  return parts.map((part, idx) => {
    const token = tokenMap.get(normKey(part));
    if (!token) return <React.Fragment key={idx}>{part}</React.Fragment>;
    return (
      <mark
        key={idx}
        className="bg-yellow-200 px-0.5 rounded"
        title={token.reason}
      >
        {part}
      </mark>
    );
  });
}

// ===== 多重度の合成（安全側＝広め） =====
type MultRange = { min: number; max: number | null }; // max=null は無限(*)

function parseMultiplicity(m: string): MultRange {
  const t = (m ?? "").trim();
  if (!t) return { min: 0, max: null };
  if (t === "*") return { min: 0, max: null };
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return { min: n, max: n };
  }
  const mm = t.match(/^(\d+)\s*\.\.\s*(\d+|\*)$/);
  if (mm) {
    const min = Number(mm[1]);
    const max = mm[2] === "*" ? null : Number(mm[2]);
    return { min, max };
  }
  // 想定外は「断定しない」に寄せる
  return { min: 0, max: null };
}

function formatMultiplicity(r: MultRange): string {
  if (r.max === null) {
    // 無限
    if (r.min <= 0) return "0..*";
    if (r.min == 1) return "1..*";
    return `${r.min}..*`;
  }
  if (r.min === r.max) return String(r.min);
  if (r.min === 0 && r.max === 1) return "0..1";
  return `${r.min}..${r.max}`;
}

function mergeMultiplicity(a: string, b: string): string {
  const ra = parseMultiplicity(a);
  const rb = parseMultiplicity(b);
  const min = Math.min(ra.min, rb.min);
  const max = ra.max === null || rb.max === null ? null : Math.max(ra.max, rb.max);
  return formatMultiplicity({ min, max });
}

// ===== クラス統合の候補（Explainable） =====
function computeMergeSuggestions(classes: ClassInfo[], relations: Relation[]): MergeSuggestion[] {
  if (classes.length < 2) return [];

  // 1) 各クラスの「属性キー集合」「関連シグネチャ」を作る
  const attrKeySig = new Map<string, string>();
  const relSig = new Map<string, string>();
  const relFeatures = new Map<string, { labels: Set<string>; neighbors: Set<string> }>();

  const classNameById = new Map(classes.map((c) => [c.id, c.name] as const));

  for (const c of classes) {
    const keys = c.attrs
      .map((a) => norm(a.name))
      .filter(Boolean)
      .sort();
    attrKeySig.set(c.id, keys.join("|"));
    relFeatures.set(c.id, { labels: new Set(), neighbors: new Set() });
  }

  for (const r of relations) {
    const lbl = (r.label ?? "").trim();
    const fromF = relFeatures.get(r.fromClassId);
    const toF = relFeatures.get(r.toClassId);
    if (fromF) {
      if (lbl) fromF.labels.add(lbl);
      fromF.neighbors.add(r.toClassId);
    }
    if (toF) {
      if (lbl) toF.labels.add(lbl);
      toF.neighbors.add(r.fromClassId);
    }
  }

  for (const c of classes) {
    const f = relFeatures.get(c.id)!;
    const lbls = Array.from(f.labels).sort().join("|");
    const neigh = Array.from(f.neighbors)
      .map((id) => classNameById.get(id) ?? id)
      .sort()
      .join("|");
    relSig.set(c.id, `${lbls}@@${neigh}`);
  }

  const suggestions: MergeSuggestion[] = [];

  // 2) 強い候補：属性シグネチャ + 関連シグネチャが完全一致
  const strongMap = new Map<string, string[]>();
  for (const c of classes) {
    const key = `A:${attrKeySig.get(c.id) ?? ""}|R:${relSig.get(c.id) ?? ""}`;
    if (!strongMap.has(key)) strongMap.set(key, []);
    strongMap.get(key)!.push(c.id);
  }
  for (const ids of strongMap.values()) {
    if (ids.length < 2) continue;
    const names = ids.map((id) => classNameById.get(id) ?? id);
    const reasons: string[] = [];
    const a0 = attrKeySig.get(ids[0]) ?? "";
    if (a0) reasons.push("属性の構成が一致しています（同じ属性名の集合）");
    const r0 = relSig.get(ids[0]) ?? "";
    if (r0) reasons.push("関連のつながり方が一致しています（同じ関連ラベル・接続先）");
    suggestions.push({
      id: `strong:${ids.join(",")}`,
      classIds: ids,
      title: `統合候補：${names.join(" / ")}`,
      reasons: reasons.length ? reasons : ["構造が非常に似ています"],
    });
  }

  // 3) 中程度：関連ラベルが一致し、主な接続先も一致
  //    （属性がない/少ない問題でも候補が出るようにする）
  const relOnlyMap = new Map<string, string[]>();
  for (const c of classes) {
    const key = `R:${relSig.get(c.id) ?? ""}`;
    if (!relOnlyMap.has(key)) relOnlyMap.set(key, []);
    relOnlyMap.get(key)!.push(c.id);
  }
  for (const ids of relOnlyMap.values()) {
    if (ids.length < 2) continue;
    // すでに strong に含まれるグループは除外
    const alreadyStrong = suggestions.some(
      (s) => s.classIds.length === ids.length && s.classIds.every((id) => ids.includes(id))
    );
    if (alreadyStrong) continue;
    const names = ids.map((id) => classNameById.get(id) ?? id);
    const reasons: string[] = ["同じ関連ラベル・接続先を持っています（OD例のふるまいが近い）"];
    suggestions.push({
      id: `rel:${ids.join(",")}`,
      classIds: ids,
      title: `統合候補：${names.join(" / ")}`,
      reasons,
    });
  }

  // 長すぎると邪魔なので上位だけ
  return suggestions.slice(0, 6);
}

// ===== メインコンポーネント =====
const ClassEditorPage: React.FC = () => {
  const router = useRouter();
  const { classProblemText, classAnswerPuml } = useProblemConfig();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [encodedPuml, setEncodedPuml] = useState<string>("");

  // ===== OD→CD 連携（ODページから渡されたスナップショット） =====
  const [odObjects, setOdObjects] = useState<Obj[]>([]);
  const [odLinks, setOdLinks] = useState<Link[]>([]);
  const [odRelationHints, setOdRelationHints] = useState<RelationHint[]>([]);

  // ===== クラス統合支援（モードなし：ダイアログ方式） =====
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Record<string, boolean>>({});
  const [mergeNewName, setMergeNewName] = useState<string>("");
  const [mergeError, setMergeError] = useState<string>("");

  // ===== 初期読み込み =====
  useEffect(() => {
    // 1) 保存済み状態があればそれを優先
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as { classes: ClassInfo[]; relations: Relation[] };
        if (parsed.classes) setClasses(parsed.classes);
        if (parsed.relations) setRelations(parsed.relations);
        return;
      }
    } catch {
      // 無視
    }

    // 2) ODページからの初期payload
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;

      // 旧形式（EditorInitialPayload）/ 新形式（EditorPayload）どちらでも動くように読む
      const parsed = JSON.parse(raw) as EditorInitialPayload | EditorPayload;

      const initialClassPuml = (parsed as EditorPayload).initialClassPuml ?? (parsed as EditorInitialPayload).initialClassPuml;
      const { classes: initClasses, relations: initRelations } = parseInitialPuml(initialClassPuml);

      setClasses(initClasses);
      setRelations(initRelations);
      if (initClasses.length > 0) setSelectedClassId(initClasses[0].id);

      // ODスナップショット（あれば）
      const payload = parsed as EditorPayload;
      if (payload.snapshot?.objects && payload.snapshot?.links) {
        setOdObjects(payload.snapshot.objects);
        setOdLinks(payload.snapshot.links);
      } else {
        setOdObjects([]);
        setOdLinks([]);
      }
      setOdRelationHints(payload.relationHints ?? []);
    } catch {
      // 無視
    }
  }, []);

  // ===== PlantUML の再生成 =====
  useEffect(() => {
    if (classes.length === 0) {
      setEncodedPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");
    lines.push("hide empty members");
    lines.push("skinparam classAttributeIconSize 0");

    const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

    // クラス定義：選択中クラス → 青、選択中関連の両端クラス → 赤系
    for (const cls of classes) {
      const isSelectedClass = cls.id === selectedClassId;
      const isEndpointOfSelectedRelation =
        selectedRelation && (selectedRelation.fromClassId === cls.id || selectedRelation.toClassId === cls.id);

      let colorPart = "";
      if (isSelectedClass) {
        // クラス選択 → 青
        colorPart = " #CCEEFF"; // 薄い水色
      } else if (isEndpointOfSelectedRelation) {
        // 選択中関連の両端 → 赤系
        colorPart = " #FFCCCC"; // 薄いピンク
      }

      lines.push(`class ${esc(cls.name)}${colorPart} {`);
      for (const a of cls.attrs) {
        const ty = a.type || "string";
        lines.push(`  ${esc(a.name)}: ${ty}`);
      }
      lines.push("}");
    }

    // 関連定義：選択中関連だけ赤線
    for (const r of relations) {
      const from = classes.find((c) => c.id === r.fromClassId);
      const to = classes.find((c) => c.id === r.toClassId);
      if (!from || !to) continue;

      const isRelSelected = r.id === selectedRelationId;
      const arrow = isRelSelected ? `-[#red]-` : "--";
      const leftMult = r.leftMultiplicity || "";
      const rightMult = r.rightMultiplicity || "";
      const labelPart = r.label ? ` : ${esc(r.label)}` : "";

      lines.push(`${esc(from.name)} "${leftMult}" ${arrow} "${rightMult}" ${esc(to.name)}${labelPart}`);
    }

    lines.push("@enduml");

    try {
      const encoded = plantumlEncoder.encode(lines.join("\n"));
      setEncodedPuml(encoded);
    } catch (e) {
      console.error("encode error", e);
      setEncodedPuml("");
    }
  }, [classes, relations, selectedClassId, selectedRelationId]);

  const previewUrl = useMemo(() => (encodedPuml ? `https://www.plantuml.com/plantuml/svg/${encodedPuml}` : ""), [encodedPuml]);

  const feedbackMessages = useMemo(() => makeFeedback(classes, relations), [classes, relations]);

  const mergeSuggestions = useMemo(() => computeMergeSuggestions(classes, relations), [classes, relations]);

  const mergeNameChips = useMemo(() => {
    // 固定リストは使わず、教員が登録した「クラス図 正答例 PlantUML」からクラス名を抽出して候補として出す
    // ※ 正答例が未設定の場合は候補を表示しない（空配列）
    const fromAnswer = extractClassNamesFromPuml(classAnswerPuml);
    // 学習者の現在のクラス名と完全一致するものも候補としては出してよいが、重複は除去される
    return fromAnswer;
  }, [classAnswerPuml]);

  // 選択中要素
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

  // 問題文ハイライト対象（トークン）
  const problemHighlightTokens = useMemo<HighlightToken[]>(() => {
    const tokens: HighlightToken[] = [];

    const pushWithBase = (raw: string | null | undefined, context: string) => {
      const t = String(raw ?? "").trim();
      if (!t) return;

      // 完全一致（入力そのまま）
      tokens.push({
        match: t,
        priority: 2,
        reason: `${context}「${t}」に一致`,
      });

      // 例）利用者B を選んだとき、問題文の「利用者」も拾えるようにする
      const base = baseNameForProblemHighlight(t);
      if (base && base !== t) {
        tokens.push({
          match: base,
          priority: 1,
          reason: `${context}「${t}」から末尾の識別子を除いた「${base}」に一致`,
        });
      }
    };

    if (selectedClass) {
      pushWithBase(selectedClass.name, "選択中のクラス名");
    }

    if (selectedRelation) {
      if (selectedRelation.label) pushWithBase(selectedRelation.label, "選択中の関連ラベル");
      const from = classes.find((c) => c.id === selectedRelation.fromClassId);
      const to = classes.find((c) => c.id === selectedRelation.toClassId);
      if (from) pushWithBase(from.name, "選択中の関連の端点（クラス名）");
      if (to) pushWithBase(to.name, "選択中の関連の端点（クラス名）");
    }

    // 重複除去（同じ match が複数ある場合は priority の高い方を残す）
    const byKey = new Map<string, HighlightToken>();
    for (const t of tokens) {
      const k = String(t.match ?? "").trim().toLowerCase();
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev || (t.priority ?? 0) > (prev.priority ?? 0)) byKey.set(k, t);
    }
    return Array.from(byKey.values());
  }, [selectedClass, selectedRelation, classes]);

  // 「部分一致でハイライトしている」ことを明示する（初学者向け）
  const highlightExplain = useMemo(() => {
    const name = (selectedClass?.name ?? "").trim();
    if (!name) return null;
    const base = baseNameForProblemHighlight(name);
    if (!base || base === name) return null;
    return { name, base };
  }, [selectedClass?.name]);

  // ===== OD→CD 連携: OD側リンクの集計（フィードバック用） =====
  const odLinkSummary = useMemo(() => {
    if (odObjects.length === 0 && odLinks.length === 0) return null;

    const objById = new Map<string, Obj>(odObjects.map((o) => [o.id, o]));
    const valid: { endpointKey: string; a: string; b: string; labelNorm: string }[] = [];

    for (const l of odLinks) {
      const fromObj = objById.get(l.from);
      const toObj = objById.get(l.to);
      if (!fromObj || !toObj) continue;
      if (!fromObj.name?.trim() || !toObj.name?.trim()) continue;

      const a = baseNameForAssist(fromObj.name);
      const b = baseNameForAssist(toObj.name);
      if (!a || !b) continue;

      const endpointKey = makeEndpointKey(a, b);
      valid.push({ endpointKey, a, b, labelNorm: normalizeLinkLabel(l.label ?? "") });
    }

    const totalValidLinks = valid.length;

    // 端点ペアごとに集計（OD上の「関係の種類」）
    const byEndpoint = new Map<
      string,
      { a: string; b: string; count: number; labels: Map<string, number> }
    >();

    for (const v of valid) {
      const existing = byEndpoint.get(v.endpointKey);
      if (!existing) {
        byEndpoint.set(v.endpointKey, {
          a: v.a <= v.b ? v.a : v.b,
          b: v.a <= v.b ? v.b : v.a,
          count: 1,
          labels: new Map<string, number>(v.labelNorm ? [[v.labelNorm, 1]] : []),
        });
      } else {
        existing.count += 1;
        if (v.labelNorm) existing.labels.set(v.labelNorm, (existing.labels.get(v.labelNorm) ?? 0) + 1);
      }
    }

    const endpointKinds = Array.from(byEndpoint.entries())
      .map(([key, v]) => ({
        key,
        pretty: `${v.a} — ${v.b}`,
        count: v.count,
        topLabels: Array.from(v.labels.entries())
          .sort((x, y) => y[1] - x[1])
          .slice(0, 2)
          .map(([lbl, cnt]) => ({ label: lbl, count: cnt })),
      }))
      .sort((x, y) => y.count - x.count || x.pretty.localeCompare(y.pretty, "ja"));

	    // ODリンクのラベル出現回数（上位）
	    // ※ 端点の一致とは別に「同じラベルが何回出るか」を見せるための集計
	    const labelCounts = new Map<string, number>();
	    for (const v of valid) {
	      if (!v.labelNorm) continue;
	      labelCounts.set(v.labelNorm, (labelCounts.get(v.labelNorm) ?? 0) + 1);
	    }
	    const labelTop = Array.from(labelCounts.entries())
	      .map(([label, count]) => ({ label, count }))
	      .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label, "ja"))
	      .slice(0, 6);

    // CD側（このページで作成中のクラス図）の関連数も、ODと比較できる形で数える
    const cdPairs = new Set<string>();
    for (const r of relations) {
      const from = classes.find((c) => c.id === r.fromClassId);
      const to = classes.find((c) => c.id === r.toClassId);
      if (!from || !to) continue;
      const a = baseNameForAssist(from.name);
      const b = baseNameForAssist(to.name);
      if (!a || !b) continue;
      cdPairs.add(makeEndpointKey(a, b));
    }

    // RelationHints（OD→CD変換時のヒント）を「端点ペア」に寄せる
    const hintsByEndpoint = new Map<string, { pretty: string; labels: { label: string; count: number }[] }>();
    for (const h of odRelationHints ?? []) {
      const a = baseNameForAssist(h.fromClass);
      const b = baseNameForAssist(h.toClass);
      if (!a || !b) continue;
      const k = makeEndpointKey(a, b);
      const pretty = `${a <= b ? a : b} — ${a <= b ? b : a}`;
      hintsByEndpoint.set(k, {
        pretty,
        labels: (h.candidates ?? []).slice().sort((x, y) => y.count - x.count).slice(0, 2),
      });
    }

    // OD→CD変換ヒントの「(端点ペア, ラベル)」上位
    // 端点ペアごとの候補ラベルをフラット化して、学習の材料として見せる。
    const hintFlat = new Map<
      string,
      { pretty: string; label: string; count: number }
    >();
    for (const h of odRelationHints ?? []) {
      const a = baseNameForAssist(h.fromClass);
      const b = baseNameForAssist(h.toClass);
      if (!a || !b) continue;
      const x = a <= b ? a : b;
      const y = a <= b ? b : a;
      const pretty = `${x} — ${y}`;

      for (const c of h.candidates ?? []) {
        const lbl = normalizeLinkLabel(c.label ?? "");
        if (!lbl) continue;
        const key = `${x}||${y}||${lbl}`;
        const prev = hintFlat.get(key);
        hintFlat.set(key, {
          pretty,
          label: lbl,
          count: (prev?.count ?? 0) + (c.count ?? 0),
        });
      }
    }
    const convertHintsTop = Array.from(hintFlat.values())
      .sort((p, q) => q.count - p.count || p.pretty.localeCompare(q.pretty, "ja"))
      .slice(0, 6);

    return {
      totalValidLinks,
      endpointKindCount: endpointKinds.length,
      endpointKindsTop: endpointKinds.slice(0, 4),
      labelTop,
      convertHintsTop,
      cdRelationCount: relations.length,
      cdEndpointKindCount: cdPairs.size,
      hintsByEndpoint,
    };
  }, [odObjects, odLinks, odRelationHints, classes, relations]);

  // ===== ODリンク一覧（対応表示用） =====
  const odLinkItems = useMemo(() => {
    const items: {
      id: string;
      fromName: string;
      toName: string;
      fromBase: string;
      toBase: string;
      endpointKey: string;
      label: string;
      labelNorm: string;
      pretty: string;
    }[] = [];

    const byId = new Map<string, Obj>();
    for (const o of (odObjects ?? [])) byId.set(o.id, o);

    for (const l of (odLinks ?? [])) {
      const fromObj = byId.get(l.from);
      const toObj = byId.get(l.to);
      const fromName = (fromObj?.name ?? "").trim();
      const toName = (toObj?.name ?? "").trim();
      if (!fromName || !toName) continue;

      const fromBase = baseNameForAssist(fromName);
      const toBase = baseNameForAssist(toName);
      if (!fromBase || !toBase) continue;

      const label = (l.label ?? "").trim();
      const labelNorm = normalizeLinkLabel(label);
      const endpointKey = makeEndpointKey(fromBase, toBase);
      const pretty = labelNorm
        ? `${fromName} — ${toName}（${labelNorm}）`
        : `${fromName} — ${toName}`;

      items.push({
        id: l.id,
        fromName,
        toName,
        fromBase,
        toBase,
        endpointKey,
        label,
        labelNorm,
        pretty,
      });
    }

    return items;
  }, [odObjects, odLinks]);

  // ===== 選択中の関連 ← ODリンク対応（学習用） =====
  const selectedRelationOdMapping = useMemo(() => {
    if (!selectedRelationId) return null;
    const rel = relations.find((r) => r.id === selectedRelationId);
    if (!rel) return null;

    const fromCls = classes.find((c) => c.id === rel.fromClassId);
    const toCls = classes.find((c) => c.id === rel.toClassId);
    if (!fromCls || !toCls) return null;

    const a = baseNameForAssist(fromCls.name);
    const b = baseNameForAssist(toCls.name);
    if (!a || !b) return null;

    const endpointKey = makeEndpointKey(a, b);
    const relLabelNorm = normalizeLinkLabel(rel.label ?? "");

    const hits = odLinkItems.filter((x) => x.endpointKey === endpointKey);

    const strong = relLabelNorm
      ? hits.filter((x) => x.labelNorm === relLabelNorm)
      : [];

    const labelStats = new Map<string, number>();
    for (const h of hits) {
      const k = h.labelNorm || "(未入力)";
      labelStats.set(k, (labelStats.get(k) ?? 0) + 1);
    }
    const labelTop = Array.from(labelStats.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([label, count]) => ({ label, count }));

    const pretty = a <= b ? `${a} — ${b}` : `${b} — ${a}`;

    return {
      pretty,
      endpointKey,
      relationLabelNorm: relLabelNorm,
      hits,
      strong,
      labelTop,
    };
  }, [selectedRelationId, relations, classes, odLinkItems]);

  // ===== ハンドラ：クラス =====
  const openMergeDialog = (preselectIds: string[] = []) => {
    const next: Record<string, boolean> = {};
    for (const c of classes) next[c.id] = false;
    for (const id of preselectIds) if (id in next) next[id] = true;
    setMergeSelected(next);
    setMergeNewName("");
    setMergeError("");
    setMergeOpen(true);
  };

  const closeMergeDialog = () => {
    setMergeOpen(false);
    setMergeError("");
  };

  const applySuggestionToMerge = (ids: string[]) => {
    setMergeSelected((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = false;
      for (const id of ids) if (id in next) next[id] = true;
      return next;
    });
    setMergeError("");
  };

  const performMerge = () => {
    const ids = Object.entries(mergeSelected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const name = mergeNewName.trim();

    if (ids.length < 2) {
      setMergeError("統合するには 2 つ以上のクラスを選択してください。");
      return;
    }
    if (!name) {
      setMergeError("統合後のクラス名を入力してください。");
      return;
    }

    const selectedClasses = classes.filter((c) => ids.includes(c.id));
    if (selectedClasses.length < 2) {
      setMergeError("選択されたクラスが見つかりませんでした。");
      return;
    }

    const newId = makeId();

    // 属性は安全側に「和集合」（同名は先勝ち、型が違う場合は string に寄せる）
    const attrMap = new Map<string, ClassAttr>();
    for (const c of selectedClasses) {
      for (const a of c.attrs) {
        const key = norm(a.name);
        if (!key) continue;
        if (!attrMap.has(key)) {
          attrMap.set(key, { ...a, id: makeId() });
        } else {
          const exist = attrMap.get(key)!;
          if (exist.type !== a.type) {
            exist.type = "string";
          }
        }
      }
    }
    const mergedAttrs = Array.from(attrMap.values()).sort((x, y) => x.name.localeCompare(y.name));

    const newClass: ClassInfo = {
      id: newId,
      name,
      attrs: mergedAttrs,
    };

    // 1) クラス更新
    const remainingClasses = classes.filter((c) => !ids.includes(c.id));
    const nextClasses = [...remainingClasses, newClass];

    // 2) 関連更新（参照付け替え）
    let nextRelations = relations
      .map((r) => {
        const fromMerged = ids.includes(r.fromClassId);
        const toMerged = ids.includes(r.toClassId);
        if (!fromMerged && !toMerged) return r;
        return {
          ...r,
          fromClassId: fromMerged ? newId : r.fromClassId,
          toClassId: toMerged ? newId : r.toClassId,
        };
      })
      .filter((r) => {
        // 統合により self-loop ができるのは許容。ただし空のクラス参照は除外。
        return !!r.fromClassId && !!r.toClassId;
      });

    // 3) 重複関連の統合（同じ端点ペア + 同じラベルをまとめる）
    //    端点の向きが逆の場合は多重度をスワップしてから合成
    type Agg = { base: Relation };
    const agg = new Map<string, Agg>();

    const keyOf = (a: string, b: string, label: string) => {
      const x = a <= b ? a : b;
      const y = a <= b ? b : a;
      return `${x}--${y}::${label.trim()}`;
    };

    for (const r of nextRelations) {
      const label = (r.label ?? "").trim();
      const k = keyOf(r.fromClassId, r.toClassId, label);
      const existing = agg.get(k);
      if (!existing) {
        agg.set(k, { base: { ...r } });
        continue;
      }

      // 向き合わせ
      const base = existing.base;
      const sameDirection = base.fromClassId === r.fromClassId && base.toClassId === r.toClassId;
      const left = sameDirection ? r.leftMultiplicity : r.rightMultiplicity;
      const right = sameDirection ? r.rightMultiplicity : r.leftMultiplicity;

      base.leftMultiplicity = mergeMultiplicity(base.leftMultiplicity, left);
      base.rightMultiplicity = mergeMultiplicity(base.rightMultiplicity, right);
      if (!base.label && label) base.label = label;
    }
    nextRelations = Array.from(agg.values()).map((a) => a.base);

    setClasses(nextClasses);
    setRelations(nextRelations);
    setSelectedClassId(newId);
    setSelectedRelationId(null);
    closeMergeDialog();
  };

  const handleAddClass = () => {
    const id = makeId();
    const newClass: ClassInfo = {
      id,
      name: "クラス名未定",
      attrs: [],
    };
    setClasses((prev) => [...prev, newClass]);
    setSelectedClassId(id);
    // ここでは関連選択はそのままでも良いが、混乱を避けるならクリア
    setSelectedRelationId(null);
  };

  const handleUpdateClass = (id: string, partial: Partial<ClassInfo>) => {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));
  };

  const handleDeleteClass = (id: string) => {
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) => prev.filter((r) => r.fromClassId !== id && r.toClassId !== id));
    if (selectedClassId === id) setSelectedClassId(null);
    setSelectedRelationId(null);
  };

  const handleAddAttr = (classId: string) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? {
              ...c,
              attrs: [...c.attrs, { id: makeId(), name: "", type: "string" as const }],
            }
          : c
      )
    );
  };

  const handleUpdateAttr = (classId: string, attrId: string, partial: Partial<ClassAttr>) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? {
              ...c,
              attrs: c.attrs.map((a) => (a.id === attrId ? { ...a, ...partial } : a)),
            }
          : c
      )
    );
  };

  const handleDeleteAttr = (classId: string, attrId: string) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === classId ? { ...c, attrs: c.attrs.filter((a) => a.id !== attrId) } : c))
    );
  };

  // ===== ハンドラ：関連 =====
  const handleAddRelation = () => {
    if (classes.length < 2) return;
    const newRel: Relation = {
      id: makeId(),
      fromClassId: classes[0].id,
      toClassId: classes[1].id,
      label: "",
      leftMultiplicity: "1",
      rightMultiplicity: "0..1",
    };
    setRelations((prev) => [...prev, newRel]);
    setSelectedRelationId(newRel.id);
  };

  const handleUpdateRelation = (id: string, partial: Partial<Relation>) => {
    setRelations((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  };

  const handleDeleteRelation = (id: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== id));
    if (selectedRelationId === id) setSelectedRelationId(null);
  };

  // ===== 状態の保存・復元・リセット =====
  const handleSaveState = () => {
    const payload = { classes, relations };
    localStorage.setItem(STORAGE_KEY_EDITOR_STATE, JSON.stringify(payload));
    alert("現在のクラス図の状態を保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!raw) {
        alert("保存されている状態がありません。");
        return;
      }
      const parsed = JSON.parse(raw) as { classes?: ClassInfo[]; relations?: Relation[] };
      setClasses(parsed.classes ?? []);
      setRelations(parsed.relations ?? []);
      setSelectedClassId(parsed.classes?.[0]?.id ?? null);
      setSelectedRelationId(null);
      alert("保存されていた状態を復元しました。");
    } catch {
      alert("状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleResetAll = () => {
    if (!window.confirm("クラス図編集の状態をすべてリセットします。よろしいですか？")) {
      return;
    }
    localStorage.removeItem(STORAGE_KEY_EDITOR_STATE);
    const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
    if (!raw) {
      setClasses([]);
      setRelations([]);
      setSelectedClassId(null);
      setSelectedRelationId(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as EditorInitialPayload | EditorPayload;
      const initialClassPuml =
        (parsed as EditorPayload).initialClassPuml ?? (parsed as EditorInitialPayload).initialClassPuml;

      const { classes: initClasses, relations: initRelations } = parseInitialPuml(initialClassPuml);
      setClasses(initClasses);
      setRelations(initRelations);
      setSelectedClassId(initClasses[0]?.id ?? null);
      setSelectedRelationId(null);
    } catch {
      setClasses([]);
      setRelations([]);
      setSelectedClassId(null);
      setSelectedRelationId(null);
    }
  };

  // 多重度候補（既存の値も含めて選択できるようにする）
  const multiplicityOptions = useMemo(() => {
    const base = ["1", "0..1", "0..*", "1..*"];
    const s = new Set(base);
    for (const r of relations) {
      if (r.leftMultiplicity) s.add(r.leftMultiplicity);
      if (r.rightMultiplicity) s.add(r.rightMultiplicity);
    }
    return Array.from(s.values());
  }, [relations]);

  const mergeSelectedIds = useMemo(
    () => Object.entries(mergeSelected).filter(([, v]) => v).map(([k]) => k),
    [mergeSelected]
  );

  const mergeImpact = useMemo(() => {
    const ids = new Set(mergeSelectedIds);
    if (ids.size === 0) return { relationTouched: 0, classCount: 0 };
    let touched = 0;
    for (const r of relations) {
      if (ids.has(r.fromClassId) || ids.has(r.toClassId)) touched += 1;
    }
    return { relationTouched: touched, classCount: ids.size };
  }, [mergeSelectedIds, relations]);

  // ===== レイアウト =====
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* ヘッダ */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white">
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-slate-100 text-sm hover:bg-slate-200"
            onClick={() => router.push("/experiment")}
          >
            ← オブジェクト図へ戻る
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-rose-100 text-rose-700 text-sm font-semibold hover:bg-rose-200"
            onClick={handleResetAll}
          >
            すべてリセット
          </button>
          <button
            className="px-3 py-1 rounded bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200"
            onClick={handleSaveState}
          >
            状態を保存
          </button>
          <button
            className="px-3 py-1 rounded bg-sky-100 text-sky-700 text-sm font-semibold hover:bg-sky-200"
            onClick={handleLoadState}
          >
            保存状態を復元
          </button>
        </div>
      </div>

      {/* メイン：左 6 / 右 4 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左側 6 : 問題文 + 編集 */}
        <div className="w-3/5 flex flex-col border-r overflow-hidden min-h-0">
          {/* 左上：クラス図作成問題文 */}
          <div className="h-2/5 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">クラス図作成問題（本文）</div>
            <div className="flex-1 p-3 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap">
              {highlightExplain && (
                <div className="mb-2 text-[11px] text-slate-600">
                  選択中のクラス名「
                  <span className="font-semibold">{highlightExplain.name}</span>
                  」に合わせて、要求文中の「
                  <span className="font-semibold">{highlightExplain.base}</span>
                  」も強調表示しています。
                </div>
              )}

              {highlightText(classProblemText, problemHighlightTokens)}
            </div>
          </div>

          {/* 左下：クラス編集＋関連編集 */}
          <div className="flex-1 grid grid-cols-2 bg-slate-50 min-h-0">
            {/* クラスの編集 */}
            <div className="border-r flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">クラスの編集</span>
                <div className="flex items-center gap-2">
                  <button
                    className="px-2 py-0.5 text-xs rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                    onClick={() => openMergeDialog()}
                    disabled={classes.length < 2}
                    title={classes.length < 2 ? "統合するにはクラスが 2 つ以上必要です" : "複数のクラスを 1 つに統合します"}
                  >
                    ⇄ クラスを統合
                  </button>
                  <button
                    className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                    onClick={handleAddClass}
                  >
                    ＋ クラスを追加
                  </button>
                </div>
              </div>

              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* クラス一覧 */}
                <div className="w-2/5 border-r overflow-y-auto bg-slate-50 text-xs">
                  {classes.length === 0 && (
                    <div className="p-2 text-[11px] text-slate-500">
                      まだクラスがありません。「クラスを追加」から作成してください。
                    </div>
                  )}
                  {classes.map((c) => {
                    const isSelected = selectedClassId === c.id;
                    const isEndpointOfSelectedRelation =
                      selectedRelation && (selectedRelation.fromClassId === c.id || selectedRelation.toClassId === c.id);

                    let itemColor = "";
                    if (isSelected) {
                      // クラス選択 → 青
                      itemColor = "bg-sky-200 border-sky-400";
                    } else if (isEndpointOfSelectedRelation) {
                      // 選択中関連の両端 → 赤系
                      itemColor = "bg-red-50 border-red-300";
                    } else {
                      itemColor = "bg-slate-50 border-slate-200";
                    }

                    const hoverColor = isSelected ? "hover:bg-sky-200" : "hover:bg-sky-50";

                    return (
                      <button
                        key={c.id}
                        className={`w-full text-left px-2 py-1 border-b flex items-center justify-between transition-colors ${itemColor} ${hoverColor}`}
                        onClick={() => {
                          // クラスの選択はトグル、関連の選択は保持したまま
                          setSelectedClassId(isSelected ? null : c.id);
                        }}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-[10px] text-slate-500 ml-1">{c.attrs.length} 属性</span>
                      </button>
                    );
                  })}
                </div>

                {/* クラス詳細 */}
                <div className="flex-1 overflow-y-auto p-2 text-xs bg-white">
                  {!selectedClass && (
                    <div className="text-[11px] text-slate-500">左の一覧から編集したいクラスを選択してください。</div>
                  )}
                  {selectedClass && (
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">クラス名</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-[12px]"
                          value={selectedClass.name}
                          onChange={(e) => handleUpdateClass(selectedClass.id, { name: e.target.value })}
                          placeholder="例）学生、授業 など"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold">属性一覧</span>
                          <button
                            className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                            onClick={() => handleAddAttr(selectedClass.id)}
                          >
                            ＋ 属性を追加
                          </button>
                        </div>
                        {selectedClass.attrs.length === 0 && (
                          <div className="text-[11px] text-slate-500 mb-1">例）属性名：年齢、型：string など</div>
                        )}
                        <div className="flex flex-col gap-1">
                          {selectedClass.attrs.map((a) => (
                            <div key={a.id} className="border rounded px-2 py-1 bg-slate-50 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <input
                                  className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                  value={a.name}
                                  onChange={(e) => handleUpdateAttr(selectedClass.id, a.id, { name: e.target.value })}
                                  placeholder="属性名（例：年齢）"
                                />
                                <span className="text-[11px] text-slate-400">:</span>
                                <select
                                  className="border rounded px-1 py-0.5 text-[11px]"
                                  value={a.type}
                                  onChange={(e) => handleUpdateAttr(selectedClass.id, a.id, { type: e.target.value })}
                                >
                                  <option value="string">string</option>
                                  <option value="int">int</option>
                                  <option value="real">real</option>
                                  <option value="boolean">boolean</option>
                                </select>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteAttr(selectedClass.id, a.id)}
                                >
                                  🗑 属性を削除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-dashed border-red-200 flex justify-end">
                        <button
                          className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 font-semibold hover:bg-red-200"
                          onClick={() => handleDeleteClass(selectedClass.id)}
                        >
                          🗑 このクラスを削除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 関連と多重度の編集 */}
            <div className="flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">関連と多重度の編集</span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddRelation}
                >
                  ＋ 関連を追加
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-slate-50 text-xs">
                {relations.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだ関連がありません。どのクラス同士が関係しているか、矢印と多重度を追加してみましょう。
                  </div>
                )}
                {relations.map((r) => {
                  const isSelected = selectedRelationId === r.id;

                  return (
                    <div
                      key={r.id}
                      className={
                        "m-2 p-2 border rounded bg-white flex flex-col gap-1 cursor-pointer transition-colors " +
                        (isSelected ? "border-red-400 ring-1 ring-red-300 bg-red-50" : "border-slate-200 hover:bg-slate-50")
                      }
                      onClick={() => setSelectedRelationId(isSelected ? null : r.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={r.fromClassId}
                          onChange={(e) => handleUpdateRelation(r.id, { fromClassId: e.target.value })}
                        >
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={r.leftMultiplicity}
                          onChange={(e) => handleUpdateRelation(r.id, { leftMultiplicity: e.target.value })}
                        >
                          {multiplicityOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>

                        <span className="text-[11px]">→</span>

                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={r.rightMultiplicity}
                          onChange={(e) => handleUpdateRelation(r.id, { rightMultiplicity: e.target.value })}
                        >
                          {multiplicityOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>

                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={r.toClassId}
                          onChange={(e) => handleUpdateRelation(r.id, { toClassId: e.target.value })}
                        >
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px]">関連名:</span>
                        <input
                          className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                          value={r.label}
                          onChange={(e) => handleUpdateRelation(r.id, { label: e.target.value })}
                          placeholder="例）履修する、担当する など"
                        />
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <div />
                        <button
                          className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleDeleteRelation(r.id);
                          }}
                        >
                          🗑 この関連を削除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 右側 4 : プレビュー＋フィードバック */}
        <div className="w-2/5 flex flex-col overflow-hidden min-h-0">
          {/* 右上：クラス図プレビュー */}
          <div className="h-1/2 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">あなたのクラス図（プレビュー）</div>
            <div className="flex-1 overflow-auto">
              {!previewUrl && (
                <div className="p-3 text-[11px] text-slate-500">
                  左側でクラスと関連を編集すると、ここにクラス図が表示されます。
                </div>
              )}
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="あなたのクラス図プレビュー" className="w-full h-full object-contain" />
              )}
            </div>
          </div>

          {/* 右下：フィードバック */}
          <div className="flex-1 bg-slate-50 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b bg-white font-semibold text-sm">フィードバック</div>
            <div className="flex-1 p-3 overflow-auto text-[11px] leading-relaxed">
              <p className="mb-1 text-slate-600">今のクラス図の状態から、学習のヒントになりそうなポイントをまとめています。</p>
              <ul className="list-disc pl-5 space-y-1">
                {feedbackMessages.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>

              {/* ===== OD→CD 連携の追加ヒント（見た目は崩さない：同じ段落/小見出し） ===== */}
              {odLinkSummary && (
                <div className="mt-3 border-t pt-3">
                  <div className="font-semibold text-slate-700 mb-1">OD（オブジェクト図）からの手がかり</div>
                  <div className="text-slate-600">
                    <div>
                      <span className="font-semibold">ODのリンク</span>：{odLinkSummary.totalValidLinks} 本（端点が有効なもの）
                    </div>
                    <div className="mt-0.5">
                      <span className="font-semibold">ODの「関係の種類」</span>：{odLinkSummary.endpointKindCount} 種
                      <span className="text-slate-500">（端点ペアごと）</span>
                    </div>
                    <div className="mt-0.5">
                      <span className="font-semibold">このクラス図の関連</span>：{odLinkSummary.cdRelationCount} 本 ／
                      <span className="font-semibold"> 端点ペア</span>：{odLinkSummary.cdEndpointKindCount} 種
                    </div>

                    {odLinkSummary.endpointKindsTop.length > 0 && (
                      <div className="mt-2">
                        <div className="font-semibold text-slate-700">ODリンクの集計（どの組み合わせが多いか）</div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          ODでつないだオブジェクト同士を「種類（末尾の番号などを除いた名前）」でまとめて数えています。
                          回数が多い組み合わせは、クラス図で関連を考えるときの手がかりになります。
                        </div>
                        <ul className="list-disc pl-5 space-y-0.5 mt-1">
                          {odLinkSummary.endpointKindsTop.map((e) => {
                            const hint = odLinkSummary.hintsByEndpoint.get(e.key);
                            return (
                              <li key={e.key}>
                                <span className="font-semibold">{e.pretty}</span>：{e.count} 回
                                {hint && hint.labels.length > 0 && (
                                  <span className="text-slate-600"> ／ 関連名候補：{hint.labels.map((x) => x.label).join(" / ")}</span>
                                )}
                                {!hint && e.topLabels.length > 0 && (
                                  <span className="text-slate-600"> ／ ODラベル例：{e.topLabels.map((x) => x.label).join(" / ")}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <div className="mt-1 text-slate-500">
                          ※ これは「答えの強制」ではなく、検討の材料です。根拠があってODと違う設計にするなら、そのままでもOKです。
                        </div>
                      </div>
                    )}

                    {odLinkSummary.labelTop.length > 0 && (
                      <div className="mt-3">
                        <div className="font-semibold text-slate-700">ODリンクから推定された関連ラベル（上位）</div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          ODで同じ意味のラベルが繰り返し出ている場合、クラス図の関連名の候補になります（そのまま使っても、言い換えてもOKです）。
                        </div>
                        <ul className="list-disc pl-5 space-y-0.5 mt-1">
                          {odLinkSummary.labelTop.map((x) => (
                            <li key={x.label}>
                              <span className="font-semibold">{x.label}</span>：{x.count} 回
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {odLinkSummary.convertHintsTop.length > 0 && (
                      <div className="mt-3">
                        <div className="font-semibold text-slate-700">推定クラス図の関係ヒント（上位）</div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          変換結果（推定クラス図）の傾向です。「このクラス間で、この関連名が出やすい」を参考として表示します。
                        </div>
                        <ul className="list-disc pl-5 space-y-0.5 mt-1">
                          {odLinkSummary.convertHintsTop.map((x, idx) => (
                            <li key={idx}>
                              <span className="font-semibold">{x.pretty}</span>：{x.label}（{x.count}）
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {odLinkItems.length > 0 && (
                      <div className="mt-3">
                        <div className="font-semibold text-slate-700">
                          ODリンク ⇄ クラス図の関連（対応を見て学ぶ）
                        </div>

                        {!selectedRelationOdMapping ? (
                          <div className="mt-1 text-[11px] text-slate-600">
                            右側の一覧で <span className="font-semibold">関連</span> を選ぶと、その関連と
                            端点（クラス名の組み合わせ）が一致するODリンクを表示します。
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-slate-600">
                            <span className="font-semibold">{selectedRelationOdMapping.pretty}</span>
                            に対応するODリンク（端点一致）：{selectedRelationOdMapping.hits.length} 件
                            {selectedRelationOdMapping.relationLabelNorm && (
                              <> ／ ラベル一致：{selectedRelationOdMapping.strong.length} 件</>
                            )}
                          </div>
                        )}

                        {selectedRelationOdMapping && selectedRelationOdMapping.hits.length === 0 && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            端点が一致するODリンクが見つかりませんでした（クラス名の一般化の仕方が違う可能性があります）。
                          </div>
                        )}

                        {selectedRelationOdMapping && selectedRelationOdMapping.hits.length > 0 && (
                          <>
                            {selectedRelationOdMapping.labelTop.length > 0 && (
                              <div className="mt-1 text-[11px] text-slate-500">
                                参考：この端点ペアのODラベル（上位）：
                                {selectedRelationOdMapping.labelTop
                                  .map((x) => `${x.label}×${x.count}`)
                                  .join(" / ")}
                              </div>
                            )}

                            <div className="mt-2 rounded border bg-white p-2">
                              <ul className="list-disc pl-5 space-y-0.5">
                                {selectedRelationOdMapping.hits.slice(0, 8).map((l) => (
                                  <li key={l.id}>
                                    {l.pretty}
                                    {selectedRelationOdMapping.relationLabelNorm &&
                                      l.labelNorm !== selectedRelationOdMapping.relationLabelNorm && (
                                        <span className="text-amber-700">（ラベル違い）</span>
                                      )}
                                  </li>
                                ))}
                              </ul>

                              {selectedRelationOdMapping.hits.length > 8 && (
                                <div className="mt-1 text-[11px] text-slate-500">
                                  …他 {selectedRelationOdMapping.hits.length - 8} 件
                                </div>
                              )}
                            </div>

                            <div className="mt-1 text-[11px] text-slate-500">
                              ※ クラス図では、ODの動詞ラベルをそのまま使う場合もあれば、
                              より一般的な表現に言い換える場合もあります（完全一致しなくてもOKです）。
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!odLinkSummary && (
                <div className="mt-3 border-t pt-3 text-slate-500">
                  ODのスナップショットが見つからなかったため、OD由来のヒントは表示していません。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== クラス統合ダイアログ（モードなし・支援付き） ===== */}
      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold">クラスを統合</div>
                <div className="text-[11px] text-slate-500">
                  どれを 1 つのクラスにまとめるか迷う場合は、左の「おすすめ候補」から選べます。
                </div>
              </div>
              <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm" onClick={closeMergeDialog}>
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-0">
              {/* 左：おすすめ候補 */}
              <div className="border-r p-4 min-h-[420px]">
                <div className="font-semibold text-sm mb-2">おすすめ候補</div>
                {mergeSuggestions.length === 0 && (
                  <div className="text-[12px] text-slate-500">
                    いまの状態からは強い統合候補が見つかりませんでした。右側で統合したいクラスを選んでください。
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {mergeSuggestions.map((s) => (
                    <div key={s.id} className="border rounded p-2 bg-slate-50">
                      <div className="text-[12px] font-semibold mb-1">{s.title}</div>
                      <ul className="list-disc pl-5 text-[11px] text-slate-600 space-y-0.5">
                        {s.reasons.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">{s.classIds.length} クラスを統合</span>
                        <button
                          className="px-2 py-1 rounded bg-sky-100 text-sky-700 text-xs font-semibold hover:bg-sky-200"
                          onClick={() => applySuggestionToMerge(s.classIds)}
                        >
                          この候補を選択
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右：手動選択 + 名前 */}
              <div className="p-4 min-h-[420px]">
                <div className="font-semibold text-sm mb-2">手動で選ぶ</div>
                <div className="border rounded h-[220px] overflow-auto">
                  {classes.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1 border-b text-[12px] hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={!!mergeSelected[c.id]}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setMergeSelected((prev) => ({ ...prev, [c.id]: checked }));
                          setMergeError("");
                        }}
                      />
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{c.attrs.length} 属性</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[12px] font-semibold">統合後のクラス名</label>
                    <span className="text-[11px] text-slate-500">
                      選択中：{mergeImpact.classCount} クラス ／ 影響する関連：{mergeImpact.relationTouched} 本
                    </span>
                  </div>
                  <input
                    className="w-full border rounded px-2 py-1 text-[12px]"
                    placeholder="例）学生"
                    value={mergeNewName}
                    onChange={(e) => {
                      setMergeNewName(e.target.value);
                      setMergeError("");
                    }}
                  />

                  {mergeNameChips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {mergeNameChips.map((t) => (
                        <button
                          key={t}
                          className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[11px]"
                          onClick={() => setMergeNewName(t)}
                          type="button"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {mergeError && <div className="mt-2 text-[12px] text-red-600">{mergeError}</div>}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm" onClick={closeMergeDialog}>
                    キャンセル
                  </button>
                  <button
                    className="px-3 py-1 rounded bg-emerald-100 text-emerald-800 font-semibold hover:bg-emerald-200 text-sm"
                    onClick={performMerge}
                    title="選択した複数クラスを 1 つにまとめます"
                  >
                    統合する
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassEditorPage;
