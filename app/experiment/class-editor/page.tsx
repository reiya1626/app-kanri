
// app/experiment/class-editor/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  kind?: "association" | "inheritance";
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
type InheritanceCandidate = {
  children: string[];
  sharedAttrs: string[];
  childSpecificAttrs: Record<string, string[]>;
  strength: "strong" | "weak";
  score: number;
  suggestedParentName?: string;
  explanationFacts: string[];
  explanationSummary: string;
};

type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  inheritanceCandidates?: InheritanceCandidate[];
  snapshot?: { objects: Obj[]; links: Link[] };
};

type MultiplicityPick = { side: "left" | "right"; value: "0..1" | "1" | "0..*" | "1..*" };

// ===== 定数 =====
const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// ★ 多重度は4択で確実に選択できるように固定
const MULT4 = ["0..1", "1", "0..*", "1..*"] as const;

// ===== UI 小物：? ヘルプ（クリックで説明を表示） =====
const HelpBadge = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-600"
        aria-label="用語の説明"
        aria-expanded={open}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-[320px] max-w-[80vw] whitespace-pre-wrap rounded border bg-white px-2 py-1 text-[11px] text-slate-700 shadow"
        >
          {text}
        </div>
      )}
    </span>
  );
};

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// 文字列エスケープ
const esc = (s: string) => s.replace(/"/g, '\\"');

// 正規表現用エスケープ
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===== 問題文ハイライト用（部分一致の強化：末尾の識別子だけ落とす） =====
const baseNameForProblemHighlight = (raw: string) => {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  s = s.replace(/[_\-\s]+$/g, "").trim();
  s = s.replace(/[0-9]+$/g, "");
  s = s.replace(/[０-９]+$/g, "");
  s = s.replace(/[A-Za-z]+[0-9]+$/g, "");
  s = s.replace(/[Ａ-Ｚａ-ｚ]+[0-9]+$/g, "");
  s = s.replace(/[Ａ-Ｚａ-ｚ]+[０-９]+$/g, "");

  if (/[A-Za-zＡ-Ｚａ-ｚ]$/.test(s)) {
    const head = s.slice(0, -1);
    if (/[ぁ-んァ-ン一-龥ー]/.test(head)) s = head;
  }

  return s.trim();
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ===== OD→CD 連携: 文字正規化 =====
const stripHtmlTags = (s: string) => (s ?? "").replace(/<[^>]*>/g, "");

const normalizeObjectLabel = (raw: string) => {
  const noTags = stripHtmlTags(raw).trim();
  const left = noTags.includes(":") ? noTags.split(":")[0].trim() : noTags;
  return left.replace(/^"+|"+$/g, "").trim();
};

const baseNameForAssist = (name: string) => {
  let s = normalizeObjectLabel(name);
  s = s.replace(/[_\-\s]+$/g, "");
  return s.trim();
};

const normalizeLinkLabel = (raw: string) => {
  return stripHtmlTags(raw ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "");
};

// ===== OD→クラス推定 =====
const baseNameDigits = (s: string): string => normalizeObjectLabel(s).replace(/\d+$/g, "").trim();
const normSlotKey = (s: string): string =>
  stripHtmlTags(String(s ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

type InferredClassAssign = {
  objIdToClass: Map<string, string>;
  classToObjIds: Map<string, string[]>;
};

const inferClassAssignmentFromSnapshot = (objects: Obj[]): InferredClassAssign => {
  const objIdToClass = new Map<string, string>();
  const classToObjIds = new Map<string, string[]>();

  const addMember = (cls: string, objId: string) => {
    objIdToClass.set(objId, cls);
    if (!classToObjIds.has(cls)) classToObjIds.set(cls, []);
    classToObjIds.get(cls)!.push(objId);
  };

  const objInfos = objects.map((o) => {
    const base = baseNameDigits(o.name) || normalizeObjectLabel(o.name);
    const keySet = new Set<string>();
    for (const a of o.slots ?? []) {
      const k = normSlotKey(a.key);
      if (k) keySet.add(k);
    }
    const attrKeys = Array.from(keySet.values()).sort();
    const hasAttrs = attrKeys.length > 0;
    return { obj: o, base, attrKeys, hasAttrs };
  });

  for (const info of objInfos.filter((i) => !i.hasAttrs)) {
    const className = info.base || normalizeObjectLabel(info.obj.name);
    addMember(className, info.obj.id);
  }

  const attrFullInfos = objInfos.filter((i) => i.hasAttrs);
  const patternGroups = new Map<string, { objId: string }[]>();

  for (const info of attrFullInfos) {
    const patternKey = info.attrKeys.length > 0 ? info.attrKeys.join("|") : "(none)";
    if (!patternGroups.has(patternKey)) patternGroups.set(patternKey, []);
    patternGroups.get(patternKey)!.push({ objId: info.obj.id });
  }

  let unnamedIndex = 1;
  for (const [, group] of patternGroups.entries()) {
    const className = `クラス名未定${unnamedIndex++}`;
    for (const m of group) addMember(className, m.objId);
  }

  return { objIdToClass, classToObjIds };
};

const makeEndpointKey = (aBase: string, bBase: string) => {
  const x = aBase <= bBase ? aBase : bBase;
  const y = aBase <= bBase ? bBase : aBase;
  return `${x}||${y}`;
};

// ===== OD（オブジェクト図）プレビュー生成 =====
const formatSlotValueForPuml = (raw: string) => {
  const s = String(raw ?? "").trim();
  if (!s) return '""';
  const low = s.toLowerCase();
  if (low === "true" || low === "false") return low;
  if (/^[+-]?\d+$/.test(s)) return s;
  if (/^[+-]?\d+\.\d+$/.test(s)) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
};

const buildObjectDiagramPuml = (objs: Obj[], links: Link[]) => {
  if (!objs || objs.length === 0) return "";

  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("hide empty members");
  lines.push("skinparam shadowing false");

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

    if (line.startsWith("class ")) {
      const m = line.match(/^class\s+(.+?)(?:\s+<<.*?>>)?\s*\{/);
      if (m) {
        const name = m[1].trim();
        const cls: ClassInfo = { id: makeId(), name, attrs: [] };
        classes.push(cls);
        currentClass = cls;
        continue;
      }
    }

    if (line === "}") {
      currentClass = null;
      continue;
    }

    if (currentClass) {
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

    const mInheritance = raw.match(/^(.+?)\s+--\|>\s+(.+)$/);
    if (mInheritance) {
      const fromName = mInheritance[1].trim().replace(/^"|"$/g, "");
      const toName = mInheritance[2].trim().replace(/^"|"$/g, "");
      relations.push({
        id: makeId(),
        fromClassId: fromName,
        toClassId: toName,
        label: "",
        leftMultiplicity: "",
        rightMultiplicity: "",
        kind: "inheritance",
      });
      continue;
    }

    const mRel = raw.match(
      /^(.+?)\s+"([^"]*)"\s+(\.\.|--)\s+"([^"]*)"\s+(.+?)(?:\s*:\s*(.+))?$/
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
        kind: "association",
      });
    }
  }

  for (const r of relations) {
    const fromByName = classes.find((c) => c.name === r.fromClassId);
    if (fromByName) r.fromClassId = fromByName.id;

    const toByName = classes.find((c) => c.name === r.toClassId);
    if (toByName) r.toClassId = toByName.id;
  }

  return { classes, relations };
}

// ===== 多重度を考えるヒント生成 =====
function makeFeedback(classes: ClassInfo[], relations: Relation[]): string[] {
  const associationRelations = relations.filter((r) => r.kind !== "inheritance");
  const msgs: string[] = [
    "多重度は『片方 1 つに対して，反対側が何個つながるか』を左右それぞれで考えます．まずは問題文の言い方（必ず / 〜することがある / 複数 / 0でもよい など）を確認しましょう．",
    "オブジェクト図(OD)を作っているので，ODで各インスタンスが何個リンクを持っているか数えると，多重度の候補（例：1，0..1，0..*，1..*）を考えやすくなります．",
  ];

  if (classes.length >= 2 && associationRelations.length === 0) {
    msgs.push("関連がまだ無いので，関係しそうなクラス同士を 1 本つないでみましょう．");
  }

  return msgs;
}

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
      <mark key={idx} className="rounded bg-yellow-200 px-0.5" title={token.reason}>
        {part}
      </mark>
    );
  });
}

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
    if (r.min === 1) return "1..*";
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
  const { classProblemText } = useProblemConfig();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const classInitialNameByIdRef = useRef<Map<string, string>>(new Map());

  const [showOdEvidence, setShowOdEvidence] = useState(false);
  const [showAllOdLinks, setShowAllOdLinks] = useState(false);
  const [showOdLabelCandidates, setShowOdLabelCandidates] = useState(false);

  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<"class" | "relation" | "inheritance">("class");
  const [encodedPuml, setEncodedPuml] = useState<string>("");

  const [lastMultiplicityPick, setLastMultiplicityPick] = useState<MultiplicityPick | null>(null);

  const [odObjects, setOdObjects] = useState<Obj[]>([]);
  const [odLinks, setOdLinks] = useState<Link[]>([]);
  const [odRelationHints, setOdRelationHints] = useState<RelationHint[]>([]);
  const [inheritanceCandidates, setInheritanceCandidates] = useState<InheritanceCandidate[]>([]);
  const [parentNameDrafts, setParentNameDrafts] = useState<Record<string, string>>({});

  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3.0;
  const [classZoom, setClassZoom] = useState(1);
  const [odZoom, setOdZoom] = useState(0.8);

  const [isMultiplicityEditing, setIsMultiplicityEditing] = useState(false);
  const multEditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (classes.some((c) => (c.attrs ?? []).some((a) => !String(a.name ?? "").trim()))) {
      reasons.push("属性名");
    }
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

  useEffect(() => {
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as {
          classes?: ClassInfo[];
          relations?: Relation[];
        };
        setClasses(parsed.classes ?? []);
        if (parsed.classes && classInitialNameByIdRef.current.size === 0) {
          const m0 = new Map<string, string>();
          for (const c of parsed.classes) m0.set(c.id, c.name);
          classInitialNameByIdRef.current = m0;
        }

        setRelations(parsed.relations ?? []);
        setSelectedClassId(parsed.classes?.[0]?.id ?? null);
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;

      const parsed = JSON.parse(raw) as EditorInitialPayload | EditorPayload;

      const hasSaved = !!localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!hasSaved) {
        const initialClassPuml =
          (parsed as EditorPayload).initialClassPuml ??
          (parsed as EditorInitialPayload).initialClassPuml;

        const { classes: initClasses, relations: initRelations } = parseInitialPuml(initialClassPuml);

        setClasses(initClasses);
        const m1 = new Map<string, string>();
        for (const c of initClasses) m1.set(c.id, c.name);
        classInitialNameByIdRef.current = m1;

        setRelations(initRelations);
        setSelectedClassId(initClasses[0]?.id ?? null);
        setSelectedRelationId(null);
      }

      const payload = parsed as EditorPayload;
      if (payload.snapshot?.objects && payload.snapshot?.links) {
        setOdObjects(payload.snapshot.objects);
        setOdLinks(payload.snapshot.links);
      } else {
        setOdObjects([]);
        setOdLinks([]);
      }
      setOdRelationHints(payload.relationHints ?? []);
      const candidates = payload.inheritanceCandidates ?? [];
      setInheritanceCandidates(candidates);
      const drafts: Record<string, string> = {};
      candidates.forEach((cand, idx) => {
        const key = cand.children.join("||");
        drafts[key] = cand.suggestedParentName ?? `親クラス候補${idx + 1}`;
      });
      setParentNameDrafts(drafts);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (classes.length === 0 || previewHoldReasons.length > 0) {
      setEncodedPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");
    lines.push("hide empty members");
    lines.push("skinparam classAttributeIconSize 0");

    const selectedRelation =
      relations.find((r) => r.id === selectedRelationId && r.kind !== "inheritance") ?? null;

    const aliasById = new Map<string, string>();
    for (const cls of classes) {
      const safe = String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_");
      aliasById.set(cls.id, `C_${safe}`);
    }

    for (const cls of classes) {
      const isSelectedClass = cls.id === selectedClassId;
      const isEndpointOfSelectedRelation =
        selectedRelation &&
        (selectedRelation.fromClassId === cls.id || selectedRelation.toClassId === cls.id);

      let colorPart = "";
      if (isSelectedClass) colorPart = " #CCEEFF";
      else if (isEndpointOfSelectedRelation) colorPart = " #FFCCCC";

      const alias = aliasById.get(cls.id) ?? `C_${String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;
      lines.push(`class "${esc(cls.name)}" as ${alias}${colorPart} {`);
      for (const a of cls.attrs) {
        const ty = a.type || "string";
        lines.push(`  ${esc(a.name)}: ${ty}`);
      }
      lines.push("}");
    }

    for (const r of relations) {
      const from = classes.find((c) => c.id === r.fromClassId);
      const to = classes.find((c) => c.id === r.toClassId);
      if (!from || !to) continue;

      const isRelSelected = r.id === selectedRelationId;
      const fromAlias = aliasById.get(from.id) ?? `C_${String(from.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;
      const toAlias = aliasById.get(to.id) ?? `C_${String(to.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;

      if (r.kind === "inheritance") {
        const arrow = isRelSelected ? "-[#red]-|>" : "--|>";
        lines.push(`${fromAlias} ${arrow} ${toAlias}`);
        continue;
      }

      const arrow = isRelSelected ? "-[#red]-" : "--";
      const leftMult = esc(r.leftMultiplicity || "");
      const rightMult = esc(r.rightMultiplicity || "");
      const labelPart = r.label ? ` : ${esc(r.label)}` : "";
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

  const odPuml = useMemo(() => buildObjectDiagramPuml(odObjects, odLinks), [odObjects, odLinks]);
  const odEncodedPuml = useMemo(() => (odPuml ? plantumlEncoder.encode(odPuml) : ""), [odPuml]);
  const odPreviewUrl = useMemo(
    () => (odEncodedPuml ? `https://www.plantuml.com/plantuml/svg/${odEncodedPuml}` : ""),
    [odEncodedPuml]
  );

  const feedbackMessages = useMemo(() => makeFeedback(classes, relations), [classes, relations]);

  const inheritanceStrong = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "strong"),
    [inheritanceCandidates]
  );
  const inheritanceWeak = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "weak"),
    [inheritanceCandidates]
  );

  const handleApplyInheritanceCandidate = (cand: InheritanceCandidate) => {
    const key = cand.children.join("||");
    const parentName = (parentNameDrafts[key] ?? "").trim();
    if (!parentName) {
      alert("親クラス名を入力してください。");
      return;
    }

    const childClasses = classes.filter((c) => cand.children.includes(c.name));
    if (childClasses.length !== cand.children.length) {
      alert("対象の子クラスが見つかりませんでした。");
      return;
    }

    const parentId = makeId();
    const parentAttrs: ClassAttr[] = cand.sharedAttrs.map((name) => {
      const found = childClasses.flatMap((c) => c.attrs).find((a) => a.name === name);
      return { id: makeId(), name, type: found?.type ?? "string" };
    });

    setClasses((prev) => {
      const stripped = prev.map((cls) => {
        if (!cand.children.includes(cls.name)) return cls;
        return {
          ...cls,
          attrs: cls.attrs.filter((a) => !cand.sharedAttrs.includes(a.name)),
        };
      });
      return [...stripped, { id: parentId, name: parentName, attrs: parentAttrs }];
    });

    setRelations((prev) => {
      const additions = childClasses
        .filter(
          (child) =>
            !prev.some(
              (r) => r.kind === "inheritance" && r.fromClassId === child.id && r.toClassId === parentId
            )
        )
        .map((child) => ({
          id: makeId(),
          fromClassId: child.id,
          toClassId: parentId,
          label: "",
          leftMultiplicity: "",
          rightMultiplicity: "",
          kind: "inheritance" as const,
        }));
      return [...prev, ...additions];
    });
  };

  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedRelation =
    relations.find((r) => r.id === selectedRelationId && r.kind !== "inheritance") ?? null;

  useEffect(() => {
    setShowOdEvidence(false);
    setShowAllOdLinks(false);
    setShowOdLabelCandidates(false);
  }, [selectedRelationId]);

  const inferredAssign = useMemo(() => {
    if (!odObjects || odObjects.length === 0) return null;
    return inferClassAssignmentFromSnapshot(odObjects);
  }, [odObjects]);

  const getInitialClassName = (classId: string) => {
    return classInitialNameByIdRef.current.get(classId) ?? classes.find((c) => c.id === classId)?.name ?? "";
  };

  const multiplicityAssist = useMemo(() => {
    if (!selectedRelation) return null;
    if (!inferredAssign) {
      return {
        leftName: "",
        rightName: "",
        betweenTotalLinks: 0,
        betweenLabelsSorted: [] as { display: string; count: number }[],
        obsLeftToRight: null as null | { min: number; max: number; rec: string; samples: number },
        obsRightToLeft: null as null | { min: number; max: number; rec: string; samples: number },
        concreteLinks: [] as string[],
        note: "ODスナップショットが無い/空のため，検討材料を作れません．",
      };
    }

    const leftClass = classes.find((c) => c.id === selectedRelation.fromClassId) ?? null;
    const rightClass = classes.find((c) => c.id === selectedRelation.toClassId) ?? null;
    if (!leftClass || !rightClass) return null;

    const leftName = leftClass.name || "（未入力）";
    const rightName = rightClass.name || "（未入力）";

    const leftKey = getInitialClassName(leftClass.id) || leftName;
    const rightKey = getInitialClassName(rightClass.id) || rightName;

    const objById = new Map<string, Obj>(odObjects.map((o) => [o.id, o]));
    const leftObjIds = inferredAssign.classToObjIds.get(leftKey) ?? [];
    const rightObjIds = inferredAssign.classToObjIds.get(rightKey) ?? [];

    const leftCountByObj = new Map<string, number>();
    const rightCountByObj = new Map<string, number>();
    for (const id of leftObjIds) leftCountByObj.set(id, 0);
    for (const id of rightObjIds) rightCountByObj.set(id, 0);

    const betweenLabelCounts = new Map<string, { display: string; count: number }>();
    let betweenTotalLinks = 0;
    const concreteLinks: string[] = [];

    const addLabel = (rawLbl: string) => {
      const lblNorm = normalizeLinkLabel(rawLbl);
      if (!lblNorm) return;
      const prev = betweenLabelCounts.get(lblNorm);
      betweenLabelCounts.set(lblNorm, {
        display: prev?.display ?? rawLbl,
        count: (prev?.count ?? 0) + 1,
      });
    };

    const isBetween = (aId: string, bId: string) => {
      const aC = inferredAssign.objIdToClass.get(aId);
      const bC = inferredAssign.objIdToClass.get(bId);
      if (!aC || !bC) return false;
      return (aC === leftKey && bC === rightKey) || (aC === rightKey && bC === leftKey);
    };

    for (const l of odLinks) {
      const aObj = objById.get(l.from);
      const bObj = objById.get(l.to);
      if (!aObj || !bObj) continue;
      if (!isBetween(aObj.id, bObj.id)) continue;

      betweenTotalLinks += 1;

      const rawLbl = stripHtmlTags(String(l.label ?? "")).trim().replace(/^"+|"+$/g, "");
      if (rawLbl) addLabel(rawLbl);

      const aC = inferredAssign.objIdToClass.get(aObj.id);
      const bC = inferredAssign.objIdToClass.get(bObj.id);

      const leftFirst =
        aC === leftKey && bC === rightKey
          ? { l: aObj, r: bObj }
          : bC === leftKey && aC === rightKey
            ? { l: bObj, r: aObj }
            : { l: aObj, r: bObj };

      const line =
        rawLbl && rawLbl.trim().length > 0
          ? `${leftFirst.l.name} — ${leftFirst.r.name}（ラベル：${rawLbl}）`
          : `${leftFirst.l.name} — ${leftFirst.r.name}`;
      concreteLinks.push(line);

      if (aC === leftKey && bC === rightKey) {
        leftCountByObj.set(aObj.id, (leftCountByObj.get(aObj.id) ?? 0) + 1);
        rightCountByObj.set(bObj.id, (rightCountByObj.get(bObj.id) ?? 0) + 1);
      } else if (aC === rightKey && bC === leftKey) {
        rightCountByObj.set(aObj.id, (rightCountByObj.get(aObj.id) ?? 0) + 1);
        leftCountByObj.set(bObj.id, (leftCountByObj.get(bObj.id) ?? 0) + 1);
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

    const betweenLabelsSorted = Array.from(betweenLabelCounts.values())
      .filter((x) => x.display)
      .sort((x, y) => y.count - x.count || x.display.localeCompare(y.display, "ja"));

    const note =
      leftObjIds.length === 0 || rightObjIds.length === 0
        ? "（この関連の端点クラスに対応するODインスタンスが推定できませんでした）"
        : "";

    return {
      leftName,
      rightName,
      betweenTotalLinks,
      betweenLabelsSorted,
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
      concreteLinks,
      note,
    };
  }, [selectedRelation, classes, odObjects, odLinks, inferredAssign]);

  const odLabelCandidates = useMemo(() => {
    const arr = (multiplicityAssist?.betweenLabelsSorted ?? [])
      .map((x) => String(x.display ?? "").trim())
      .filter((s) => !!s);
    return Array.from(new Set(arr));
  }, [multiplicityAssist]);

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

    if (selectedClass) pushWithBase(selectedClass.name, "選択中のクラス名");

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
          .map(([label, count]) => ({ label, count })),
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
    if (!classInitialNameByIdRef.current.has(id)) {
      classInitialNameByIdRef.current.set(id, newClass.name);
    }

    setClasses((prev) => [...prev, newClass]);
    setSelectedClassId(id);
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
          ? { ...c, attrs: [...c.attrs, { id: makeId(), name: "", type: "string" }] }
          : c
      )
    );
  };

  const handleUpdateAttr = (classId: string, attrId: string, partial: Partial<ClassAttr>) => {
    setClasses((prev) =>
      prev.map((c) =>
        c.id === classId
          ? { ...c, attrs: c.attrs.map((a) => (a.id === attrId ? { ...a, ...partial } : a)) }
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
      kind: "association",
    };
    setRelations((prev) => [...prev, newRel]);
    setSelectedRelationId(newRel.id);
    setSelectedClassId(null);
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
      alert("保存状態の復元に失敗しました．");
    }
  };

  const handleResetState = () => {
    if (!window.confirm("保存済みのクラス図状態を削除して，初期状態からやり直しますか？")) return;
    localStorage.removeItem(STORAGE_KEY_EDITOR_STATE);
    window.location.reload();
  };

  const selectedRelationAll = relations.find((r) => r.id === selectedRelationId) ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1600px] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">クラス図編集</h1>
            <p className="text-sm text-slate-600">
              編集する場所と参考情報を分けて表示しています。必要なときだけ根拠を開いて確認してください。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => router.back()} className="rounded border bg-white px-3 py-2 text-sm">戻る</button>
            <button type="button" onClick={handleLoadState} className="rounded border bg-white px-3 py-2 text-sm">復元</button>
            <button type="button" onClick={handleSaveState} className="rounded border bg-white px-3 py-2 text-sm">保存</button>
            <button type="button" onClick={handleResetState} className="rounded border bg-white px-3 py-2 text-sm text-red-600">リセット</button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded border bg-white p-3">
              <div className="mb-2 text-sm font-semibold">要求文（問題）</div>
              <div className="max-h-[320px] overflow-auto whitespace-pre-wrap text-sm leading-7">
                {highlightText(classProblemText || "", problemHighlightTokens)}
              </div>
              {highlightExplain && (
                <div className="mt-2 text-xs text-slate-500">
                  選択中クラス名「{highlightExplain.name}」のベース表現「{highlightExplain.base}」も強調対象です。
                </div>
              )}
            </section>

            <details open className="rounded border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">フィードバック</summary>
              <div className="mt-3">
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {feedbackMessages.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
                {odLinkSummary && (
                  <div className="mt-3 border-t pt-3 text-xs text-slate-600">
                    <div>ODリンク総数: {odLinkSummary.totalValidLinks}</div>
                    <div>CD関連本数: {odLinkSummary.cdRelationCount}</div>
                    <div>OD端点種類数: {odLinkSummary.endpointKindCount}</div>
                    <div>CD端点種類数: {odLinkSummary.cdEndpointKindCount}</div>
                  </div>
                )}
              </div>
            </details>

            <details className="rounded border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">ODの根拠</summary>
              <div className="mt-3 space-y-3 text-sm">
                {!showOdEvidence ? (
                  <div className="text-sm text-slate-500">上部の編集で通常の関連を選んだあと、必要なら下のチェックで表示してください。</div>
                ) : multiplicityAssist ? (
                  <>
                    <div>
                      選択中関連: <span className="font-medium">{multiplicityAssist.leftName}</span> — <span className="font-medium">{multiplicityAssist.rightName}</span>
                    </div>
                    <div>ODで観測したリンク本数: {multiplicityAssist.betweenTotalLinks}</div>
                    {multiplicityAssist.obsLeftToRight && (
                      <div className="rounded bg-slate-50 p-2">
                        左→右の観測: min={multiplicityAssist.obsLeftToRight.min}, max={multiplicityAssist.obsLeftToRight.max}, 候補={multiplicityAssist.obsLeftToRight.rec}
                      </div>
                    )}
                    {multiplicityAssist.obsRightToLeft && (
                      <div className="rounded bg-slate-50 p-2">
                        右→左の観測: min={multiplicityAssist.obsRightToLeft.min}, max={multiplicityAssist.obsRightToLeft.max}, 候補={multiplicityAssist.obsRightToLeft.rec}
                      </div>
                    )}
                    {showOdLabelCandidates && (
                      <div className="rounded bg-slate-50 p-2">
                        <div className="mb-1 text-xs font-semibold text-slate-500">関連名候補</div>
                        {odLabelCandidates.length === 0 ? (
                          <div className="text-xs text-slate-500">候補はありません。</div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {odLabelCandidates.map((label) => (
                              <button
                                key={label}
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs"
                                onClick={() => selectedRelationAll && handleUpdateRelation(selectedRelationAll.id, { label })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {showAllOdLinks && (
                      <div className="rounded bg-slate-50 p-2">
                        <div className="mb-1 text-xs font-semibold text-slate-500">ODの具体リンク</div>
                        <ul className="list-disc pl-5 text-xs">
                          {multiplicityAssist.concreteLinks.map((line, idx) => (
                            <li key={idx}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setShowAllOdLinks((v) => !v)}>
                        {showAllOdLinks ? "具体リンクを隠す" : "具体リンクを表示"}
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setShowOdLabelCandidates((v) => !v)}>
                        {showOdLabelCandidates ? "関連名候補を隠す" : "関連名候補を表示"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">通常の関連を選ぶと、ここに根拠が表示されます。</div>
                )}
              </div>
            </details>
          </aside>

          <main className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
              <section className="rounded border bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">クラス一覧</div>
                  <button type="button" onClick={handleAddClass} className="rounded border px-2 py-1 text-sm">＋ クラス追加</button>
                </div>
                <div className="space-y-2">
                  {classes.map((cls) => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => {
                        setSelectedClassId(cls.id);
                        setSelectedRelationId(null);
                        setActiveEditorTab("class");
                      }}
                      className={`block w-full rounded border px-3 py-2 text-left ${selectedClassId === cls.id ? "border-blue-500 bg-blue-50" : "bg-white"}`}
                    >
                      <div className="font-medium">{cls.name || "（未入力）"}</div>
                      <div className="text-xs text-slate-500">{cls.attrs.length} 属性</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded border bg-white p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setActiveEditorTab("class")} className={`rounded px-3 py-1.5 text-sm ${activeEditorTab === "class" ? "bg-slate-900 text-white" : "border bg-white"}`}>クラス編集</button>
                    <button type="button" onClick={() => setActiveEditorTab("relation")} className={`rounded px-3 py-1.5 text-sm ${activeEditorTab === "relation" ? "bg-slate-900 text-white" : "border bg-white"}`}>関連編集</button>
                    <button type="button" onClick={() => setActiveEditorTab("inheritance")} className={`rounded px-3 py-1.5 text-sm ${activeEditorTab === "inheritance" ? "bg-slate-900 text-white" : "border bg-white"}`}>継承候補</button>
                  </div>
                  {activeEditorTab === "relation" && (
                    <button type="button" onClick={handleAddRelation} className="rounded border px-2 py-1 text-sm">＋ 関連追加</button>
                  )}
                </div>

                {activeEditorTab === "class" && (
                  <div>
                    {!selectedClass ? (
                      <div className="text-sm text-slate-500">左の一覧からクラスを選択してください。</div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-xs text-slate-500">クラス名</div>
                          <input className="w-full rounded border px-3 py-2" value={selectedClass.name} onChange={(e) => handleUpdateClass(selectedClass.id, { name: e.target.value })} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-500">属性</div>
                          <button type="button" onClick={() => handleAddAttr(selectedClass.id)} className="rounded border px-2 py-1 text-xs">＋ 属性追加</button>
                        </div>
                        <div className="space-y-2">
                          {selectedClass.attrs.map((attr) => (
                            <div key={attr.id} className="grid grid-cols-[1fr_120px_auto] gap-2">
                              <input className="rounded border px-2 py-2 text-sm" value={attr.name} onChange={(e) => handleUpdateAttr(selectedClass.id, attr.id, { name: e.target.value })} placeholder="属性名" />
                              <select className="rounded border px-2 py-2 text-sm" value={attr.type} onChange={(e) => handleUpdateAttr(selectedClass.id, attr.id, { type: e.target.value })}>
                                <option value="string">string</option>
                                <option value="int">int</option>
                                <option value="real">real</option>
                                <option value="boolean">boolean</option>
                              </select>
                              <button type="button" onClick={() => handleDeleteAttr(selectedClass.id, attr.id)} className="rounded border px-2 py-2 text-sm text-red-600">削除</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" onClick={() => handleDeleteClass(selectedClass.id)} className="rounded border px-2 py-1 text-sm text-red-600">このクラスを削除</button>
                      </div>
                    )}
                  </div>
                )}

                {activeEditorTab === "relation" && (
                  <div className="space-y-3">
                    {relations.map((r) => {
                      const from = classes.find((c) => c.id === r.fromClassId);
                      const to = classes.find((c) => c.id === r.toClassId);
                      if (!from || !to) return null;
                      const isSelected = r.id === selectedRelationId;
                      return (
                        <div key={r.id} className={`rounded border p-3 ${isSelected ? "border-blue-500 bg-blue-50" : "bg-white"}`}>
                          <button type="button" className="mb-2 block w-full text-left" onClick={() => setSelectedRelationId(r.id)}>
                            <div className="font-medium">{from.name} {r.kind === "inheritance" ? "--|>" : "--"} {to.name}</div>
                            <div className="text-xs text-slate-500">{r.kind === "inheritance" ? "継承" : "通常の関連"}</div>
                          </button>

                          {r.kind === "inheritance" ? (
                            <div className="rounded bg-slate-50 p-2 text-sm text-slate-600">
                              子クラスから親クラスへの継承です。多重度や関連名は設定しません。
                              <div className="mt-2">
                                <button type="button" className="rounded border px-2 py-1 text-sm text-red-600" onClick={() => handleDeleteRelation(r.id)}>この継承を削除</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="grid gap-2 md:grid-cols-2">
                                <div>
                                  <div className="mb-1 text-xs text-slate-500">左クラス</div>
                                  <select className="w-full rounded border px-2 py-2 text-sm" value={r.fromClassId} onChange={(e) => handleUpdateRelation(r.id, { fromClassId: e.target.value })}>
                                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <div className="mb-1 text-xs text-slate-500">右クラス</div>
                                  <select className="w-full rounded border px-2 py-2 text-sm" value={r.toClassId} onChange={(e) => handleUpdateRelation(r.id, { toClassId: e.target.value })}>
                                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="mt-2">
                                <div className="mb-1 text-xs text-slate-500">関連名</div>
                                <input className="w-full rounded border px-2 py-2 text-sm" value={r.label} onChange={(e) => handleUpdateRelation(r.id, { label: e.target.value })} placeholder="例）担当する" />
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                <div>
                                  <div className="mb-1 text-xs text-slate-500">左側多重度</div>
                                  <select className="w-full rounded border px-2 py-2 text-sm" value={r.leftMultiplicity || "0..1"} onChange={(e) => { const value = e.target.value as typeof MULT4[number]; markMultiplicityEditing(); setLastMultiplicityPick({ side: "left", value }); handleUpdateRelation(r.id, { leftMultiplicity: mergeMultiplicity(value, value) }); }}>
                                    {MULT4.map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <div className="mb-1 text-xs text-slate-500">右側多重度</div>
                                  <select className="w-full rounded border px-2 py-2 text-sm" value={r.rightMultiplicity || "0..1"} onChange={(e) => { const value = e.target.value as typeof MULT4[number]; markMultiplicityEditing(); setLastMultiplicityPick({ side: "right", value }); handleUpdateRelation(r.id, { rightMultiplicity: mergeMultiplicity(value, value) }); }}>
                                    {MULT4.map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="mt-3 flex justify-between">
                                <button type="button" className="rounded border px-2 py-1 text-sm text-red-600" onClick={() => handleDeleteRelation(r.id)}>この関連を削除</button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {relations.length === 0 && <div className="text-sm text-slate-500">関連はまだありません。</div>}
                  </div>
                )}

                {activeEditorTab === "inheritance" && (
                  <div className="space-y-4">
                    <div className="flex items-center text-sm font-semibold">
                      継承候補
                      <HelpBadge text="共通属性があり、かつ各クラスに固有属性があるとき、親クラスにまとめられる可能性があります。" />
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-500">有力候補</div>
                      <div className="space-y-3">
                        {inheritanceStrong.length === 0 && <div className="text-sm text-slate-500">有力候補はありません。</div>}
                        {inheritanceStrong.map((cand) => {
                          const key = cand.children.join("||");
                          return (
                            <div key={key} className="rounded border border-emerald-200 bg-emerald-50 p-3">
                              <div className="font-medium">{cand.children.join(" / ")}</div>
                              <div className="mt-1 text-sm">共通属性: {cand.sharedAttrs.join("，")}</div>
                              <div className="mt-1 text-xs text-slate-700">{cand.explanationSummary}</div>
                              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                                {cand.explanationFacts.map((fact, idx) => <li key={idx}>{fact}</li>)}
                              </ul>
                              <div className="mt-3 flex gap-2">
                                <input className="flex-1 rounded border px-2 py-1 text-sm" value={parentNameDrafts[key] ?? ""} onChange={(e) => setParentNameDrafts((prev) => ({ ...prev, [key]: e.target.value }))} placeholder="親クラス名" />
                                <button type="button" className="rounded border bg-white px-3 py-1 text-sm" onClick={() => handleApplyInheritanceCandidate(cand)}>採用</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-slate-500">参考候補を表示</summary>
                      <div className="mt-3 space-y-3">
                        {inheritanceWeak.length === 0 && <div className="text-sm text-slate-500">参考候補はありません。</div>}
                        {inheritanceWeak.map((cand) => {
                          const key = cand.children.join("||");
                          return (
                            <div key={key} className="rounded border bg-slate-50 p-3">
                              <div className="font-medium">{cand.children.join(" / ")}</div>
                              <div className="mt-1 text-sm">共通属性: {cand.sharedAttrs.join("，")}</div>
                              <div className="mt-1 text-xs text-slate-700">{cand.explanationSummary}</div>
                              <div className="mt-3 flex gap-2">
                                <input className="flex-1 rounded border px-2 py-1 text-sm" value={parentNameDrafts[key] ?? ""} onChange={(e) => setParentNameDrafts((prev) => ({ ...prev, [key]: e.target.value }))} placeholder="親クラス名" />
                                <button type="button" className="rounded border bg-white px-3 py-1 text-sm" onClick={() => handleApplyInheritanceCandidate(cand)}>採用</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </section>
            </div>

            <section className="rounded border bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">プレビュー</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={showOdEvidence} onChange={(e) => setShowOdEvidence(e.target.checked)} />
                    OD根拠を表示
                  </label>
                  <span className="ml-3">OD</span>
                  <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={odZoom} onChange={(e) => setOdZoom(Number(e.target.value))} />
                  <span>{Math.round(odZoom * 100)}%</span>
                  <span className="ml-3">CD</span>
                  <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={classZoom} onChange={(e) => setClassZoom(Number(e.target.value))} />
                  <span>{Math.round(classZoom * 100)}%</span>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded border bg-slate-50 p-2">
                  <div className="mb-2 text-xs font-semibold text-slate-500">オブジェクト図</div>
                  {odPreviewUrl ? (
                    <div className="max-h-[260px] overflow-auto rounded bg-white p-2">
                      <img src={odPreviewUrl} alt="OD preview" style={{ transform: `scale(${odZoom})`, transformOrigin: "top left" }} />
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">ODスナップショットがありません。</div>
                  )}
                </div>

                <div className="rounded border bg-slate-50 p-2">
                  <div className="mb-2 text-xs font-semibold text-slate-500">クラス図</div>
                  {previewHoldReasons.length > 0 && <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">プレビュー保留: {previewHoldReasons.join(" / ")}</div>}
                  {previewUrl ? (
                    <div className="max-h-[260px] overflow-auto rounded bg-white p-2">
                      <img src={previewUrl} alt="CD preview" style={{ transform: `scale(${classZoom})`, transformOrigin: "top left" }} />
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">クラス図を生成できていません。</div>
                  )}
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
};

export default ClassEditorPage;
