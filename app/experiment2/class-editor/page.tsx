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
  fromClassId: string;
  toClassId: string;
  candidates: { label: string; count: number }[];
};
type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  snapshot?: { objects: Obj[]; links: Link[] };
};

// ===== 定数 =====
const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// ★ 多重度は4択で確実に選択できるように固定
const MULT4 = ["0..1", "1", "0..*", "1..*"] as const;

// ===== UI 小物：? ヘルプ（title で説明を表示） =====
const HelpBadge = ({ text }: { text: string }) => (
  <span
    className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-600 text-[10px] cursor-help select-none"
    title={text}
    aria-label={text}
  >
    ?
  </span>
);

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// 文字列エスケープ
const esc = (s: string) => s.replace(/\"/g, '\\"');

// 正規表現用エスケープ
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===== 問題文ハイライト用（部分一致の強化：末尾の識別子だけ落とす） =====
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
  // NOTE: 末尾の番号などは削除しない（厳密に扱う）
  let s = normalizeObjectLabel(name);
  // 末尾の区切り記号だけはノイズになりやすいので削除する
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

// ===== OD（オブジェクト図）プレビュー生成（遷移前スナップショット表示用） =====
const formatSlotValueForPuml = (raw: string) => {
  const s = String(raw ?? "").trim();
  if (!s) return '""';
  // boolean
  const low = s.toLowerCase();
  if (low === "true" || low === "false") return low;
  // int / real
  if (/^[+-]?\d+$/.test(s)) return s;
  if (/^[+-]?\d+\.\d+$/.test(s)) return s;
  // already quoted
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
};

const buildObjectDiagramPuml = (objs: Obj[], links: Link[]) => {
  if (!objs || objs.length === 0) return "";

  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("hide empty members");
  lines.push("skinparam shadowing false");

  // object 定義（表示名は "..."，参照は alias）
  const aliasById = new Map<string, string>();
  let idx = 0;
  for (const o of objs) {
    const alias = `o${idx + 1}`;
    idx += 1;
    aliasById.set(o.id, alias);

    const name = String(o.name ?? "").trim() || "（未入力）";
    const safeName = name.replace(/"/g, '\\"');
    lines.push(`object "${safeName}" as ${alias}`);

    for (const sl of o.slots ?? []) {
      const key = String(sl.key ?? "").trim();
      if (!key) continue;
      const safeKey = key.replace(/"/g, '\\"');
      const value = formatSlotValueForPuml(sl.value ?? "");
      lines.push(`${alias} : ${safeKey} = ${value}`);
    }
  }

  // link 定義
  for (const l of links ?? []) {
    const a = aliasById.get(l.from);
    const b = aliasById.get(l.to);
    if (!a || !b) continue;
    const label = stripHtmlTags(String(l.label ?? "")).trim().replace(/"/g, '\\"');
    if (label) lines.push(`${a} -- ${b} : ${label}`);
    else lines.push(`${a} -- ${b}`);
  }

  lines.push("@enduml");
  return lines.join("\n");
};

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
    const mRel = raw.match(
      /^(.+?)\s+\"([^\"]*)\"\s+(\.\.|--)\s+\"([^\"]*)\"\s+(.+?)(?:\s*:\s*(.+))?$/
    );
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

// ===== 多重度を考えるヒント生成（多重度のヒント中心） =====
function makeFeedback(classes: ClassInfo[], relations: Relation[]): string[] {
  const msgs: string[] = [
    "多重度は『片方 1 つに対して，反対側が何個つながるか』を左右それぞれで考えます．まずは問題文の言い方（必ず / 〜することがある / 複数 / 0でもよい など）を確認しましょう．",
    "オブジェクト図(OD)を作っているので，ODで各インスタンスが何個リンクを持っているか数えると，多重度の候補（例：1，0..1，0..*，1..*）を考えやすくなります．",
  ];

  if (classes.length >= 2 && relations.length === 0) {
    msgs.push("関連がまだ無いので，関係しそうなクラス同士を 1 本つないでみましょう．");
  }

  return msgs;
}

// 問題文ハイライト用：選択語を <mark> で囲む
type HighlightToken = {
  match: string;
  reason: string;
  priority: number;
};

function highlightText(text: string, tokens: HighlightToken[]): ReactNode[] {
  if (!text) return [text];

  const cleaned = tokens
    .map((t) => ({ ...t, match: String(t.match ?? "").trim() }))
    .filter((t) => t.match.length > 0);
  if (cleaned.length === 0) return [text];

  const normKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const bestByMatch = new Map<string, HighlightToken>();
  for (const t of cleaned) {
    const key = normKey(t.match);
    const prev = bestByMatch.get(key);
    if (!prev || t.priority > prev.priority) bestByMatch.set(key, t);
  }

  const uniq = Array.from(bestByMatch.values()).sort((a, b) => {
    const len = b.match.length - a.match.length;
    if (len !== 0) return len;
    return b.priority - a.priority;
  });

  const pattern = uniq.map((t) => escapeRegExp(t.match)).join("|");
  if (!pattern) return [text];

  const re = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(re);

  const tokenMap = new Map<string, HighlightToken>();
  for (const t of uniq) tokenMap.set(normKey(t.match), t);

  return parts.map((part, idx) => {
    const token = tokenMap.get(normKey(part));
    if (!token) return <React.Fragment key={idx}>{part}</React.Fragment>;
    return (
      <mark key={idx} className="bg-yellow-200 px-0.5 rounded" title={token.reason}>
        {part}
      </mark>
    );
  });
}

// ===== 多重度の合成（安全側＝広め） =====
type MultRange = { min: number; max: number | null };

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
  return { min: 0, max: null };
}

function formatMultiplicity(r: MultRange): string {
  if (r.max === null) {
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

  // --- クラス図プレビュー拡大・縮小 ---
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3.0;
  const ZOOM_STEP = 0.1;
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const [classZoom, setClassZoom] = useState(1);
  const [odZoom, setOdZoom] = useState(0.8);

  // 多重度入力中はプレビューが不安定になりやすいので一時抑制
  const [isMultiplicityEditing, setIsMultiplicityEditing] = useState(false);
  const multEditTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markMultiplicityEditing = () => {
    setIsMultiplicityEditing(true);
    if (multEditTimer.current) clearTimeout(multEditTimer.current);
    multEditTimer.current = setTimeout(() => setIsMultiplicityEditing(false), 600);
  };

  useEffect(() => {
    return () => {
      if (multEditTimer.current) clearTimeout(multEditTimer.current);
    };
  }, []);

  const previewHoldReasons = useMemo(() => {
    const reasons: string[] = [];
    if (classes.length === 0) return reasons;

    if (classes.some((c) => !String(c.name ?? "").trim())) reasons.push("クラス名");
    if (classes.some((c) => (c.attrs ?? []).some((a) => !String(a.name ?? "").trim())))
      reasons.push("属性名");
    if (
      relations.some(
        (r) =>
          !classes.some((c) => c.id === r.fromClassId) ||
          !classes.some((c) => c.id === r.toClassId)
      )
    ) {
      reasons.push("関連の端点");
    }
    if (isMultiplicityEditing) reasons.push("多重度（入力中）");
    return reasons;
  }, [classes, relations, isMultiplicityEditing]);

  // ===== 初期読み込み =====
  useEffect(() => {
    // A) クラス図の編集状態（保存済み）があればそれを優先
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as {
          classes?: ClassInfo[];
          relations?: Relation[];
        };
        setClasses(parsed.classes ?? []);
        setRelations(parsed.relations ?? []);
        setSelectedClassId(parsed.classes?.[0]?.id ?? null);
        // ★ここで return しない（OD snapshot を別で読みたいので）
      }
    } catch {
      // ignore
    }

    // B) ODページからの初期payload（OD snapshot / relationHints / 初期PUML）
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;

      const parsed = JSON.parse(raw) as EditorInitialPayload | EditorPayload;

      // 初期PUMLは「保存状態が無いときだけ」反映（上書き事故を防ぐ）
      const hasSaved = !!localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!hasSaved) {
        const initialClassPuml =
          (parsed as EditorPayload).initialClassPuml ??
          (parsed as EditorInitialPayload).initialClassPuml;

        const { classes: initClasses, relations: initRelations } = parseInitialPuml(initialClassPuml);

        setClasses(initClasses);
        setRelations(initRelations);
        setSelectedClassId(initClasses[0]?.id ?? null);
        setSelectedRelationId(null);
      }

      // ★ OD snapshot は「常に」読む（保存状態があっても表示したい）
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
      // ignore
    }
  }, []);

  // ===== PlantUML の再生成 =====
  useEffect(() => {
    if (classes.length === 0 || previewHoldReasons.length > 0) {
      setEncodedPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");
    lines.push("hide empty members");
    lines.push("skinparam classAttributeIconSize 0");

    const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

    // クラス定義：表示名は "..."，内部参照は alias
    const aliasById = new Map<string, string>();
    for (const cls of classes) {
      const safe = String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_");
      aliasById.set(cls.id, `C_${safe}`);
    }

    // 選択中クラス → 青，選択中関連の両端クラス → 赤系
    for (const cls of classes) {
      const isSelectedClass = cls.id === selectedClassId;
      const isEndpointOfSelectedRelation =
        selectedRelation &&
        (selectedRelation.fromClassId === cls.id || selectedRelation.toClassId === cls.id);

      let colorPart = "";
      if (isSelectedClass) {
        colorPart = " #CCEEFF";
      } else if (isEndpointOfSelectedRelation) {
        colorPart = " #FFCCCC";
      }

      const alias = aliasById.get(cls.id) ?? `C_${String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;
      lines.push(`class "${esc(cls.name)}" as ${alias}${colorPart} {`);
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

      const leftMult = esc(r.leftMultiplicity || "");
      const rightMult = esc(r.rightMultiplicity || "");
      const labelPart = r.label ? ` : ${esc(r.label)}` : "";

      const fromAlias = aliasById.get(from.id) ?? `C_${String(from.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;
      const toAlias = aliasById.get(to.id) ?? `C_${String(to.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;

      lines.push(`${fromAlias} "${leftMult}" ${arrow} "${rightMult}" ${toAlias}${labelPart}`);
    }

    lines.push("@enduml");

    try {
      const encoded = plantumlEncoder.encode(lines.join("\n"));
      setEncodedPuml(encoded);
    } catch (e) {
      console.error("encode error", e);
      setEncodedPuml("");
    }
  }, [classes, relations, selectedClassId, selectedRelationId, previewHoldReasons]);

  const previewUrl = useMemo(
    () => (encodedPuml ? `https://www.plantuml.com/plantuml/svg/${encodedPuml}` : ""),
    [encodedPuml]
  );

  // OD（遷移前スナップショット）のプレビューURL
  const odPuml = useMemo(() => buildObjectDiagramPuml(odObjects, odLinks), [odObjects, odLinks]);
  const odEncodedPuml = useMemo(() => (odPuml ? plantumlEncoder.encode(odPuml) : ""), [odPuml]);
  const odPreviewUrl = useMemo(
    () => (odEncodedPuml ? `https://www.plantuml.com/plantuml/svg/${odEncodedPuml}` : ""),
    [odEncodedPuml]
  );

  const feedbackMessages = useMemo(() => makeFeedback(classes, relations), [classes, relations]);

  // 選択中要素
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

  // ===== 選択中の関連：多重度ヒント =====
  const multiplicityAssist = useMemo(() => {
    if (!selectedRelation) return null;

    const leftClass = classes.find((c) => c.id === selectedRelation.fromClassId) ?? null;
    const rightClass = classes.find((c) => c.id === selectedRelation.toClassId) ?? null;
    if (!leftClass || !rightClass) return null;

    const leftName = leftClass.name || "（未入力）";
    const rightName = rightClass.name || "（未入力）";

    // --- OD変換集計（relationHints）からの補助情報（リンク数・ラベル候補） ---
    const pickRelationHint = (fromId: string, toId: string) => {
      const hit = (odRelationHints ?? []).find((h) => h.fromClassId === fromId && h.toClassId === toId);
      if (!hit) return null;

      const labels = (hit.candidates ?? [])
        .map((c) => ({ display: stripHtmlTags(String(c.label ?? "")).trim(), count: Number(c.count ?? 0) }))
        .filter((x) => x.count > 0)
        .filter((x) => x.display.length > 0)
        .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display, "ja"));

      const total = (hit.candidates ?? []).reduce((acc, c) => acc + (Number(c.count ?? 0) || 0), 0);
      return { total, labels };
    };

    const hintLeftToRight = pickRelationHint(leftClass.id, rightClass.id);
    const hintRightToLeft = pickRelationHint(rightClass.id, leftClass.id);

    const leftBase = baseNameForAssist(leftName);
    const rightBase = baseNameForAssist(rightName);

    const objById = new Map<string, Obj>(odObjects.map((o) => [o.id, o]));
    const leftCountByObj = new Map<string, number>();
    const rightCountByObj = new Map<string, number>();

    // まず 0 で初期化（ODに存在するオブジェクトのみ）
    for (const o of odObjects) {
      const b = baseNameForAssist(o.name);
      if (b && leftBase && b === leftBase) leftCountByObj.set(o.id, 0);
      if (b && rightBase && b === rightBase) rightCountByObj.set(o.id, 0);
    }

    // リンクを数える（無向として扱う）
    for (const l of odLinks) {
      const aObj = objById.get(l.from);
      const bObj = objById.get(l.to);
      if (!aObj || !bObj) continue;

      const aBase = baseNameForAssist(aObj.name);
      const bBase = baseNameForAssist(bObj.name);
      if (!aBase || !bBase) continue;

      if (leftBase && rightBase) {
        if (aBase === leftBase && bBase === rightBase) {
          leftCountByObj.set(aObj.id, (leftCountByObj.get(aObj.id) ?? 0) + 1);
          rightCountByObj.set(bObj.id, (rightCountByObj.get(bObj.id) ?? 0) + 1);
        } else if (aBase === rightBase && bBase === leftBase) {
          rightCountByObj.set(aObj.id, (rightCountByObj.get(aObj.id) ?? 0) + 1);
          leftCountByObj.set(bObj.id, (leftCountByObj.get(bObj.id) ?? 0) + 1);
        }
      }
    }

    const rangeFromCounts = (counts: number[]) => {
      if (counts.length === 0) return null;
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      return { min, max };
    };

    const recommend4 = (min: number, max: number) => {
      if (max <= 1) return min === 0 ? "0..1" : "1";
      return min === 0 ? "0..*" : "1..*";
    };

    const leftCounts = Array.from(leftCountByObj.values());
    const rightCounts = Array.from(rightCountByObj.values());

    const leftToRight = rangeFromCounts(leftCounts);
    const rightToLeft = rangeFromCounts(rightCounts);

    return {
      leftName,
      rightName,
      hintLeftToRight,
      hintRightToLeft,
      obsLeftToRight: leftToRight
        ? {
            min: leftToRight.min,
            max: leftToRight.max,
            rec: recommend4(leftToRight.min, leftToRight.max),
            samples: leftCounts.length,
          }
        : null,
      obsRightToLeft: rightToLeft
        ? {
            min: rightToLeft.min,
            max: rightToLeft.max,
            rec: recommend4(rightToLeft.min, rightToLeft.max),
            samples: rightCounts.length,
          }
        : null,
    };
  }, [selectedRelation, classes, odObjects, odLinks]);

  // 問題文ハイライト対象（トークン）
  const problemHighlightTokens = useMemo<HighlightToken[]>(() => {
    const tokens: HighlightToken[] = [];

    const pushWithBase = (raw: string | null | undefined, context: string) => {
      const t = String(raw ?? "").trim();
      if (!t) return;

      tokens.push({
        match: t,
        priority: 2,
        reason: `${context}「${t}」に一致`,
      });

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

    const byKey = new Map<string, HighlightToken>();
    for (const t of tokens) {
      const k = String(t.match ?? "").trim().toLowerCase();
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev || (t.priority ?? 0) > (prev.priority ?? 0)) byKey.set(k, t);
    }
    return Array.from(byKey.values());
  }, [selectedClass, selectedRelation, classes]);

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

    const labelCounts = new Map<string, number>();
    for (const v of valid) {
      if (!v.labelNorm) continue;
      labelCounts.set(v.labelNorm, (labelCounts.get(v.labelNorm) ?? 0) + 1);
    }
    const labelTop = Array.from(labelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label, "ja"))
      .slice(0, 6);

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

    const hintsByEndpoint = new Map<
      string,
      { pretty: string; labels: { label: string; count: number }[] }
    >();
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

    const hintFlat = new Map<string, { pretty: string; label: string; count: number }>();
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

  // ===== ハンドラ：クラス =====
  const handleAddClass = () => {
    const id = makeId();
    const newClass: ClassInfo = {
      id,
      name: "クラス名未定",
      attrs: [],
    };
    setClasses((prev) => [...prev, newClass]);
    setSelectedClassId(id);
    setSelectedRelationId(null);
  };

  const handleUpdateClass = (id: string, partial: Partial<ClassInfo>) => {
    const oldClass = classes.find((c) => c.id === id);
    const oldName = oldClass?.name;
    const newName = partial.name;
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));
    // クラス名変更時に odRelationHints を更新
    if (oldName && newName && oldName !== newName) {
      setOdRelationHints((prev) =>
        prev.map((h) => ({
          ...h,
          fromClass: h.fromClass === oldName ? newName : h.fromClass,
          toClass: h.toClass === oldName ? newName : h.toClass,
        }))
      );
    }
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
    alert("現在のクラス図の状態を保存しました．");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!raw) {
        alert("保存されている状態がありません．");
        return;
      }
      const parsed = JSON.parse(raw) as { classes?: ClassInfo[]; relations?: Relation[] };
      setClasses(parsed.classes ?? []);
      setRelations(parsed.relations ?? []);
      setSelectedClassId(parsed.classes?.[0]?.id ?? null);
      setSelectedRelationId(null);
      alert("保存されていた状態を復元しました．");
    } catch {
      alert("状態の読み込み中にエラーが発生しました．");
    }
  };

  const handleResetAll = () => {
    if (!window.confirm("クラス図編集の状態をすべてリセットします．よろしいですか？")) {
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

      {/* メイン：左／中央／右 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左側：問題文 + 編集 */}
        <div className="flex-1 flex flex-col border-r overflow-hidden min-h-0">
          {/* 左上：クラス図作成問題文 */}
          <div className="h-2/5 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">クラス図作成問題（本文）</div>
            <div className="flex-1 flex min-h-0">
              {/* 左：要求文 */}
              <div className="flex-1 p-3 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap min-w-0">
                {highlightExplain && (
                  <div className="mb-2 text-[11px] text-slate-600">
                    選択中のクラス名「<span className="font-semibold">{highlightExplain.name}</span>」に合わせて，
                    要求文中の「<span className="font-semibold">{highlightExplain.base}</span>」も強調表示しています．
                  </div>
                )}
                {highlightText(classProblemText, problemHighlightTokens)}
              </div></div>
          </div>

          {/* 左下：クラス編集＋関連編集 */}
          <div className="flex-1 grid grid-cols-2 bg-slate-50 min-h-0">
            {/* クラスの編集 */}
            <div className="border-r flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">クラスの編集</span>
                <div className="flex items-center gap-2">
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
                      まだクラスがありません．「クラスを追加」から作成してください．
                    </div>
                  )}
                  {classes.map((c) => {
                    const isSelected = selectedClassId === c.id;
                    const isEndpointOfSelectedRelation =
                      selectedRelation &&
                      (selectedRelation.fromClassId === c.id || selectedRelation.toClassId === c.id);

                    let itemColor = "";
                    if (isSelected) {
                      itemColor = "bg-sky-200 border-sky-400";
                    } else if (isEndpointOfSelectedRelation) {
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
                    <div className="text-[11px] text-slate-500">
                      左の一覧から編集したいクラスを選択してください．
                    </div>
                  )}
                  {selectedClass && (
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          クラス名
                          <HelpBadge text="クラス名：似たオブジェクトをまとめた「種類」の名前です．ODで登場したオブジェクト名（末尾の番号など）を一般化して付けます．例）学生，授業，注文 など．" />
                        </label>
                        <input
                          className="w-full border rounded px-2 py-1 text-[12px]"
                          value={selectedClass.name}
                          onChange={(e) => handleUpdateClass(selectedClass.id, { name: e.target.value })}
                          placeholder="例）学生，授業 など"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold">
                            属性一覧
                            <HelpBadge text="属性：クラスが持つ性質（データ）です．ODのスロット（key=value）の key が候補になります．型は値の種類（string/int/real/boolean）を選びます．" />
                          </span>
                          <button
                            className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                            onClick={() => handleAddAttr(selectedClass.id)}
                          >
                            ＋ 属性を追加
                          </button>
                        </div>

                        {selectedClass.attrs.length === 0 && (
                          <div className="text-[11px] text-slate-500 mb-1">
                            例）属性名：年齢，型：string など
                          </div>
                        )}

                        <div className="flex flex-col gap-1">
                          {selectedClass.attrs.map((a) => (
                            <div key={a.id} className="border rounded px-2 py-1 bg-slate-50 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <input
                                  className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                  value={a.name}
                                  onChange={(e) =>
                                    handleUpdateAttr(selectedClass.id, a.id, { name: e.target.value })
                                  }
                                  placeholder="属性名（例：年齢）"
                                />
                                <span className="text-[11px] text-slate-400">:</span>
                                <select
                                  className="border rounded px-1 py-0.5 text-[11px]"
                                  value={a.type}
                                  onChange={(e) =>
                                    handleUpdateAttr(selectedClass.id, a.id, { type: e.target.value })
                                  }
                                >
                                  <option value="string">string</option>
                                  <option value="int">int</option>
                                  <option value="real">real</option>
                                  <option value="boolean">boolean</option>
                                </select>
                                <HelpBadge text="属性の型：値の種類を表します．string=文字列，int=整数，real=小数，boolean=true/false です．ODの値に合わせて選びます．" />
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
                <span className="font-semibold text-sm">
                  関連
                  <HelpBadge text="関連：クラス同士の関係を表します．ODで結んだリンクを一般化して，クラス間の関係として整理します．" />
                  と多重度
                  <HelpBadge text="多重度：片方 1 つに対して，反対側が何個つながるかを表します．例）1=必ず 1 つ，0..1=0 または 1，0..*=0 以上，1..*=1 以上です．" />
                  の編集
                </span>
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
                    まだ関連がありません．どのクラス同士が関係しているか，矢印と多重度を追加してみましょう．
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
                      <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <span>端点と多重度</span>
                        <HelpBadge text="多重度：片方 1 つに対して，反対側が何個つながるかを表します．左右はそれぞれ，相手側の数です．" />
                      </div>

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

                        {/* ★ここから：多重度は input ではなく select（4択で確実に表示） */}
                        <select
                          className="border rounded px-1 py-0.5 text-[11px] w-[88px]"
                          value={r.leftMultiplicity}
                          onChange={(e) => {
                            markMultiplicityEditing();
                            handleUpdateRelation(r.id, { leftMultiplicity: e.target.value });
                          }}
                        >
                          {MULT4.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>

                        <span className="text-[11px]">→</span>

                        <select
                          className="border rounded px-1 py-0.5 text-[11px] w-[88px]"
                          value={r.rightMultiplicity}
                          onChange={(e) => {
                            markMultiplicityEditing();
                            handleUpdateRelation(r.id, { rightMultiplicity: e.target.value });
                          }}
                        >
                          {MULT4.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        {/* ★ここまで */}

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
                        <span className="text-[11px]">
                          関連名
                          <HelpBadge text="関連名：関係の意味を表す名前です．動詞（〜する，〜を持つ，〜を担当する 等）で書くと分かりやすくなります．ODのリンクラベルを一般化したものが候補になります．" />
                          :
                        </span>
                        <input
                          className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                          value={r.label}
                          onChange={(e) => handleUpdateRelation(r.id, { label: e.target.value })}
                          placeholder="例）履修する，担当する など"
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

        {/* 右側：プレビュー＋フィードバック */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* 右上：クラス図プレビュー */}
          <div className="h-1/2 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
              <div className="font-semibold text-sm">あなたのクラス図（プレビュー）</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] w-12 text-center tabular-nums">{Math.round(classZoom * 100)}%</span>
                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={ZOOM_STEP}
                  value={classZoom}
                  onChange={(e) => setClassZoom(clampZoom(parseFloat(e.currentTarget.value)))}
                  disabled={!previewUrl}
                  className="w-40"
                  title="ドラッグして倍率を変更"
                  aria-label="クラス図の倍率"
                />
                <button
                  type="button"
                  className="px-2 py-0.5 text-[11px] border rounded bg-white hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => setClassZoom(1)}
                  disabled={!previewUrl}
                  title="等倍（100%）"
                >
                  100%
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-white p-2">
              {!previewUrl && (
                <div className="p-3 text-[11px] text-slate-500">
                  {classes.length === 0 ? (
                    <>左側でクラスを追加すると，ここにクラス図が表示されます．</>
                  ) : previewHoldReasons.length > 0 ? (
                    <>
                      入力がそろったら，ここにクラス図が表示されます．（入力中はPlantUMLのエラー表示を抑えています．）
                      <div className="mt-1">保留：{previewHoldReasons.join("，")}</div>
                    </>
                  ) : (
                    <>いまの内容ではプレビューを表示できませんでした．入力を確認してください．</>
                  )}
                </div>
              )}
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <div style={{ zoom: classZoom }} className="inline-block origin-top-left">
                  <img src={previewUrl} alt="あなたのクラス図プレビュー" className="block max-w-none h-auto" />
                </div>
              )}
            </div>
          </div>

          {/* 右下：オブジェクト図（OD） */}
<div className="flex-1 bg-slate-50 flex flex-col min-h-0">
  <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
    <div className="font-semibold text-sm">オブジェクト図（OD）</div>
    <div className="flex items-center gap-2 text-[11px] text-slate-600">
      <span>拡大</span>
      <input
        type="range"
        min={0.4}
        max={1.6}
        step={0.05}
        value={odZoom}
        onChange={(e) => setOdZoom(Number(e.target.value))}
        className="w-28"
        aria-label="ODズーム"
      />
      <span className="w-10 text-right">{Math.round(odZoom * 100)}%</span>
    </div>
  </div>

  <div className="flex-1 overflow-auto bg-white p-2">
    {odPreviewUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <div style={{ zoom: odZoom }} className="inline-block origin-top-left">
        <img
          src={odPreviewUrl}
          alt="オブジェクト図（OD）プレビュー"
          className="block max-w-none h-auto"
        />
      </div>
    ) : (
      <div className="h-full flex items-center justify-center text-[12px] text-slate-500">
        オブジェクト図（OD）のスナップショットが見つからないため，ここには表示できません．
      </div>
    )}
  </div>
</div></div>
      </div>
    </div>
  );
};

export default ClassEditorPage;
