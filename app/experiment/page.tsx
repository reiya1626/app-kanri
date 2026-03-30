
// app/experiment/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../components/problem-config";

// ===== 型定義 =====
type Slot = { key: string; value: string };
type Obj = { id: string; name: string; slots: Slot[] };

type ObjDiagnoseSnapshot = {
  inputTotal: number;
  inputMatched: number;
  inputUnmatched: number;
  requiredCount: number;
  missingCount: number;
  extraCount: number;
  extraBases: string[];
  slotRequiredTotal: number;
  slotMissingTotal: number;
  slotMatchedTotal: number;
  extraSlotCount: number;
  slotDiffs: { base: string; onlyInInput: string[] }[];
  slotMissingByBase: { base: string; missingInInput: string[] }[];
};

type LinkDiagnoseSnapshot = {
  inputTotal: number;
  inputMatched: number;
  inputUnmatched: number;
  requiredCount: number;
  missingCount: number;
  extraCount: number;
  extraLinks: LinkSig[];
};

type Link = { id: string; from: string; to: string; label: string };

type IssuesResponse = {
  classes: { name: string; incomplete: string[]; contradictory: string[] }[];
};

type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};

type InheritanceCandidate = {
  key: string;
  children: string[];
  sharedAttrs: string[];
  childSpecificAttrs: Record<string, string[]>;
  sharedCount: number;
  strength: "strong" | "weak";
  score: number;
  suggestedParentName?: string;
  explanationFacts: string[];
  explanationSummary: string;
};

type ConvertResponse = {
  classPuml: string;
  encodedPuml: string;
  issues?: IssuesResponse;
  relationHints?: RelationHint[];
  inheritanceCandidates?: InheritanceCandidate[];
};

type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  inheritanceCandidates?: InheritanceCandidate[];
  snapshot?: { objects: Obj[]; links: Link[] };
};

type LinkSig = {
  a: string;
  b: string;
  label: string;
  endpointKey: string;
  fullKey: string;
  pretty: string;
};

const STORAGE_KEY_STATE = "EXPERIMENT_OBJECT_EDITOR_STATE";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

const makeId = () => Math.random().toString(36).slice(2);

// ===== ユーティリティ =====
type PrimType = "int" | "real" | "boolean" | "string";

const detectType = (v: string): PrimType => {
  const t = v.trim().replace(/^[[\s\n\r\t"']+|[\s\n\r\t"']+$/g, "");
  if (/^-?\d+$/.test(t)) return "int";
  if (/^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t)) return "real";
  if (/^(?:true|false)$/i.test(t)) return "boolean";
  return "string";
};

const escLabel = (s: string) => s.replace(/"/g, '\\"');

const formatSlotValue = (raw: string): string => {
  const t = raw.trim();
  if (!t) return "";
  const ty = detectType(t);
  if (ty === "int" || ty === "real") return t;
  if (ty === "boolean") return t.toLowerCase();
  return `"${escLabel(t)}"`;
};

const sanitizeClassPumlForLearner = (puml: string) => {
  if (!puml) return puml;
  let out = puml;
  out = out.replace(/:\s*([A-Za-z_][\w]*)\s*<!>\s*$/gm, ": （型が混在）");
  out = out.replace(/:\s*([A-Za-z_][\w]*)\s*<\?>\s*$/gm, ": （値が未入力）");
  out = out.replace(/:\s*<\?>\s*$/gm, ": （値が未入力）");
  out = out.replace(/<<\s*contradictory\s*>>/g, "<<型が混在>>");
  out = out.replace(/<<\s*incomplete\s*>>/g, "<<値が未入力>>");
  out = out.replace(/<!>/g, "（型が混在）");
  out = out.replace(/<\?>/g, "（値が未入力）");
  return out;
};

const forceSolidRelations = (puml: string) => {
  if (!puml) return puml;
  const lines = puml.split(/\r?\n/);
  const shouldSkipLine = (t: string) => {
    if (!t) return true;
    if (t.startsWith("'")) return true;
    if (/^(?:@startuml|@enduml|skinparam|hide|show|title|left to right direction)\b/i.test(t)) return true;
    return false;
  };
  const isRelationOpToken = (tok: string) => /^[.\-o*<>()\/\\|><]+$/.test(tok) && tok.includes(".");

  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (shouldSkipLine(trimmed)) return line;
    const parts = line.split(/(\s+)/);
    let changed = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || /^\s+$/.test(p)) continue;
      if (isRelationOpToken(p)) {
        parts[i] = p.replace(/\./g, "-");
        changed = true;
      }
    }
    return changed ? parts.join("") : line;
  });
  return out.join("\n");
};

const stripHtmlTags = (s: string) => s.replace(/<[^>]*>/g, "");
const normalizeObjectLabel = (raw: string) => {
  const noTags = stripHtmlTags(raw).trim();
  const left = noTags.includes(":") ? noTags.split(":")[0].trim() : noTags;
  return left.replace(/^"+|"+$/g, "").trim();
};
const baseNameForAssist = (name: string) => normalizeObjectLabel(name);
const normalizeLinkLabel = (raw: string) => stripHtmlTags(raw ?? "").trim().replace(/^"+|"+$/g, "").replace(/\s+/g, "");
const normalizeSlotKey = (raw: string) => stripHtmlTags(raw ?? "").trim().replace(/^"+|"+$/g, "").replace(/\s+/g, "");
const extractSlotKeyFromPumlLine = (line: string) => {
  const t = (line ?? "").trim();
  if (!t) return "";
  const m = t.match(/^(.+?)\s*[:=]/);
  return (m?.[1] ?? t).trim();
};

const extractObjectLabelsFromPuml = (puml: string) => {
  const labels: string[] = [];
  if (!puml) return labels;
  const lines = puml.split(/\r?\n/);
  const reQuoted = /^\s*object\s+"([^"]+)"(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  const reBare = /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("'")) continue;
    const m1 = line.match(reQuoted);
    if (m1?.[1]) { labels.push(m1[1]); continue; }
    const m2 = line.match(reBare);
    if (m2?.[1]) { labels.push(m2[1]); continue; }
  }
  return labels.map((s) => s.trim()).filter((s) => s.length > 0 && !/^\.+$/.test(s));
};

const extractAliasToBaseFromPuml = (puml: string) => {
  const map = new Map<string, string>();
  if (!puml) return map;
  const lines = puml.split(/\r?\n/);
  const reQuoted = /^\s*object\s+"([^"]+)"\s+as\s+([\w.\-]+)(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  const reBare = /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)\s+as\s+([\w.\-]+)(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("'")) continue;
    const m1 = line.match(reQuoted);
    if (m1?.[1] && m1?.[2]) {
      const base = baseNameForAssist(m1[1]);
      if (base) map.set(m1[2], base);
      continue;
    }
    const m2 = line.match(reBare);
    if (m2?.[1] && m2?.[2]) {
      const base = baseNameForAssist(m2[1]);
      if (base) map.set(m2[2], base);
      continue;
    }
  }
  return map;
};

const extractRequiredSlotKeysByBaseFromPuml = (puml: string) => {
  const map = new Map<string, Set<string>>();
  if (!puml) return map;
  const lines = puml.split(/\r?\n/);
  const reObjQuoted = /^\s*object\s+"([^"]+)"(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  const reObjBare = /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;
  let currentBase: string | null = null;
  let inBlock = false;
  let pendingBase: string | null = null;

  const startBlock = (base: string) => {
    currentBase = base;
    inBlock = true;
    if (!map.has(base)) map.set(base, new Set<string>());
  };
  const endBlock = () => {
    currentBase = null;
    inBlock = false;
    pendingBase = null;
  };

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t || t.startsWith("'")) continue;
    const m1 = rawLine.match(reObjQuoted);
    const m2 = rawLine.match(reObjBare);
    if (m1?.[1] || m2?.[1]) {
      const label = (m1?.[1] ?? m2?.[1] ?? "").trim();
      const base = baseNameForAssist(label);
      if (!base) { endBlock(); continue; }
      if (t.includes("{")) { startBlock(base); } else { pendingBase = base; currentBase = null; inBlock = false; }
      continue;
    }
    if (!inBlock && pendingBase && t === "{") { startBlock(pendingBase); continue; }
    if (inBlock) {
      if (t === "}") { endBlock(); continue; }
      if (t === "{") continue;
      const keyPart = extractSlotKeyFromPumlLine(t);
      const key = normalizeSlotKey(keyPart);
      if (!key) continue;
      const set = map.get(currentBase!);
      if (set) set.add(key);
    }
  }
  return map;
};

const makeEndpointKey = (aBase: string, bBase: string) => {
  const x = aBase <= bBase ? aBase : bBase;
  const y = aBase <= bBase ? bBase : aBase;
  return `${x}||${y}`;
};
const makeFullKey = (endpointKey: string, labelNorm: string) => `${endpointKey}||${labelNorm}`;

const extractLinksFromPuml = (puml: string) => {
  const out: LinkSig[] = [];
  if (!puml) return out;
  const aliasToBase = extractAliasToBaseFromPuml(puml);
  const lines = puml.split(/\r?\n/);
  const reRel = /^\s*([\w.\-ぁ-んァ-ン一-龥ー]+)\s*[-.o*<>()\/\\]+?\s*([\w.\-ぁ-んァ-ン一-龥ー]+)\s*(?::\s*(.+))?\s*$/;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("'")) continue;
    if (/^(?:@startuml|@enduml|skinparam|hide|title|left to right direction)/i.test(t)) continue;
    if (/^\s*object\s+/i.test(t)) continue;

    const m = line.match(reRel);
    if (!m?.[1] || !m?.[2]) continue;
    const leftRaw = m[1];
    const rightRaw = m[2];
    const labelRaw = m[3] ?? "";
    const label = normalizeLinkLabel(labelRaw);
    const aBase = aliasToBase.get(leftRaw) ?? baseNameForAssist(leftRaw);
    const bBase = aliasToBase.get(rightRaw) ?? baseNameForAssist(rightRaw);
    if (!aBase || !bBase) continue;

    const endpointKey = makeEndpointKey(aBase, bBase);
    const fullKey = makeFullKey(endpointKey, label);
    const pretty = label ? `${aBase} — ${bBase}（${label}）` : `${aBase} — ${bBase}`;
    out.push({ a: aBase, b: bBase, label, endpointKey, fullKey, pretty });
  }
  const uniq = new Map<string, LinkSig>();
  for (const l of out) if (!uniq.has(l.fullKey)) uniq.set(l.fullKey, l);
  return Array.from(uniq.values());
};

const usePanZoom = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - containerRef.current.offsetLeft);
    setStartY(e.pageY - containerRef.current.offsetTop);
    setScrollLeft(containerRef.current.scrollLeft);
    setScrollTop(containerRef.current.scrollTop);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startX) * 1.5;
    const walkY = (y - startY) * 1.5;
    containerRef.current.scrollLeft = scrollLeft - walkX;
    containerRef.current.scrollTop = scrollTop - walkY;
  };

  const onMouseUpOrLeave = () => setIsDragging(false);

  return {
    containerRef,
    handlers: {
      onMouseDown,
      onMouseMove,
      onMouseUp: onMouseUpOrLeave,
      onMouseLeave: onMouseUpOrLeave,
    },
    isDragging,
  };
};

const TOOLTIP = {
  objectName: "【インスタンス名】現実世界の具体物を識別するための名前です。",
  slotKey: "【スロット名（属性名）】オブジェクトが持つ情報の名前です。",
  linkEndpoints: "【リンク（関係）】オブジェクト同士の関係です。",
  linkLabel: "【リンクラベル】関係の意味を短い言葉で表します。",
} as const;

const HelpBadge: React.FC<{ title: string }> = ({ title }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
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
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 text-[10px] text-slate-500 bg-slate-50 hover:bg-slate-100 cursor-pointer"
        aria-label="用語の説明"
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[320px] max-w-[80vw] whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700 shadow-lg">
          {title}
        </div>
      )}
    </span>
  );
};

const DiagnoseGroupCard: React.FC<{
  title: string;
  tone: "missing" | "review";
  count: number;
  summary: string;
  detailLabel: string;
  onDetail: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}> = ({ title, tone, count, summary, detailLabel, onDetail, disabled, children }) => {
  const toneClass =
    tone === "missing"
      ? "border-amber-200 bg-amber-50"
      : "border-rose-200 bg-rose-50";
  const badgeClass =
    tone === "missing"
      ? "bg-amber-100 text-amber-800"
      : "bg-rose-100 text-rose-800";

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="mt-1 text-xs text-slate-600">{summary}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
          {count}件
        </span>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      <div className="mt-3">
        <button
          type="button"
          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
          onClick={onDetail}
          disabled={disabled}
        >
          {detailLabel}
        </button>
      </div>
    </div>
  );
};

const CountBadge: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="px-2 py-1 rounded bg-white border border-amber-200 text-amber-800 text-xs font-medium">
    {label} {value}
  </span>
);

const ExperimentPage: React.FC = () => {
  const router = useRouter();
  const { objectProblemText, objectAnswerPuml } = useProblemConfig();

  const [objTab, setObjTab] = useState<"edit" | "diagnose">("edit");
  const [linkTab, setLinkTab] = useState<"edit" | "diagnose">("edit");

  const [objPanelRatio, setObjPanelRatio] = useState(55);
  const [linkPanelRatio, setLinkPanelRatio] = useState(55);

  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [editingObjectId] = useState<string | null>(null);

  const [encodedObjectPuml, setEncodedObjectPuml] = useState("");
  const [classPuml, setClassPuml] = useState("");
  const [encodedClassPuml, setEncodedClassPuml] = useState("");
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);
  const [inheritanceCandidates, setInheritanceCandidates] = useState<InheritanceCandidate[]>([]);
  const [showInheritanceHint, setShowInheritanceHint] = useState(false);

  const [objectZoom, setObjectZoom] = useState(1);
  const [classZoom, setClassZoom] = useState(1);

  const objectPan = usePanZoom();
  const classPan = usePanZoom();

  const [showObjectProblemFull, setShowObjectProblemFull] = useState(false);

  const [objChecked, setObjChecked] = useState(false);
  const [objDiagnoseSnapshot, setObjDiagnoseSnapshot] = useState<ObjDiagnoseSnapshot | null>(null);
  const [objRevealExtra, setObjRevealExtra] = useState(0);
  const [objDirtySinceHint, setObjDirtySinceHint] = useState(false);
  const [objRevealMissingHints, setObjRevealMissingHints] = useState(false);
  const [objMissingDirtySinceHint, setObjMissingDirtySinceHint] = useState(false);

  const [linkChecked, setLinkChecked] = useState(false);
  const [linkDiagnoseSnapshot, setLinkDiagnoseSnapshot] = useState<LinkDiagnoseSnapshot | null>(null);
  const [linkRevealExtra, setLinkRevealExtra] = useState(0);
  const [linkDirtySinceHint, setLinkDirtySinceHint] = useState(false);
  const [linkRevealMissingHints, setLinkRevealMissingHints] = useState(false);
  const [linkMissingDirtySinceHint, setLinkMissingDirtySinceHint] = useState(false);

  const markMeaningfulChange = (affectObj: boolean, affectLink: boolean) => {
    if (affectObj) {
      setObjDirtySinceHint(true);
      setObjMissingDirtySinceHint(true);
    }
    if (affectLink) {
      setLinkDirtySinceHint(true);
      setLinkMissingDirtySinceHint(true);
    }
  };

  const objAssistScrollRef = useRef<HTMLDivElement | null>(null);
  const linkAssistScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      if (parsed.objects) setObjects(parsed.objects);
      if (parsed.links) setLinks(parsed.links);
    } catch {}
  }, []);

  const hasUnnamedObject = useMemo(
    () => objects.some((o) => !o.name || o.name.trim().length === 0),
    [objects]
  );

  useEffect(() => {
    if ((objects.length === 0 && links.length === 0) || hasUnnamedObject) {
      setEncodedObjectPuml("");
      return;
    }
    const objectHighlightIds = new Set<string>();
    const linkHighlightIds = new Set<string>();
    if (selectedObjectId) objectHighlightIds.add(selectedObjectId);
    const currentLink = links.find((l) => l.id === selectedLinkId) ?? null;
    if (currentLink) {
      linkHighlightIds.add(currentLink.from);
      linkHighlightIds.add(currentLink.to);
    }

    const lines: string[] = ["@startuml"];
    for (const o of objects) {
      const safeName = o.name || "(無名)";
      const underlined = `<u>${escLabel(safeName)}</u>`;
      const fill = objectHighlightIds.has(o.id)
        ? " #FFF6BF"
        : linkHighlightIds.has(o.id)
          ? " #FFD6E0"
          : "";
      lines.push(`object "${underlined}" as ${o.id}${fill} {`);
      for (const s of o.slots) {
        if (!s.key && !s.value) continue;
        const val = formatSlotValue(s.value);
        lines.push(`  ${val ? `${s.key} = ${val}` : s.key}`);
      }
      lines.push("}");
    }
    for (const l of links) {
      const from = objects.find((o) => o.id === l.from);
      const to = objects.find((o) => o.id === l.to);
      if (!from || !to) continue;
      const labelPart = l.label ? ` : ${escLabel(l.label)}` : "";
      const linePattern = l.id === selectedLinkId ? "-[#red]-" : "--";
      lines.push(`${from.id} ${linePattern} ${to.id}${labelPart}`);
    }
    lines.push("@enduml");
    try {
      setEncodedObjectPuml(plantumlEncoder.encode(lines.join("\n")));
    } catch {
      setEncodedObjectPuml("");
    }
  }, [objects, links, selectedObjectId, selectedLinkId, hasUnnamedObject]);

  useEffect(() => {
    if ((objects.length === 0 && links.length === 0) || hasUnnamedObject) {
      setClassPuml("");
      setEncodedClassPuml("");
      setIssues(null);
      setRelationHints([]);
      setInheritanceCandidates([]);
      return;
    }

    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: objects.map((o) => ({
              name: o.name,
              attrs: o.slots.map((s) => ({ key: s.key, value: s.value })),
            })),
            links: links.map((l) => ({
              from: objects.find((o) => o.id === l.from)?.name ?? "",
              to: objects.find((o) => o.id === l.to)?.name ?? "",
              label: l.label,
            })),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as ConvertResponse;
        const solid = forceSolidRelations(data.classPuml);
        setClassPuml(solid);
        try {
          setEncodedClassPuml(plantumlEncoder.encode(solid));
        } catch {
          setEncodedClassPuml("");
        }
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);
        setInheritanceCandidates(data.inheritanceCandidates ?? []);
      } catch (e: any) {
        if (e?.name !== "AbortError") console.error(e);
      }
    }, 500);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [objects, links, hasUnnamedObject]);

  const inheritanceStrong = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "strong"),
    [inheritanceCandidates]
  );
  const inheritanceWeak = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "weak"),
    [inheritanceCandidates]
  );
  const featuredInheritance = inheritanceStrong[0] ?? inheritanceWeak[0] ?? null;

  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );
  const selectedLink = useMemo(
    () => links.find((l) => l.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  );

  const objAssist = useMemo(() => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);

    const requiredBases = new Set<string>();
    if (enabled) {
      extractObjectLabelsFromPuml(objectAnswerPuml).forEach((raw) => {
        requiredBases.add(baseNameForAssist(raw));
      });
    }

    const presentBases = new Set<string>();
    objects.forEach((o) => {
      if (editingObjectId && o.id === editingObjectId) return;
      if (o.name?.trim()) presentBases.add(baseNameForAssist(o.name));
    });

    const missingBases = enabled
      ? Array.from(requiredBases).filter((b) => !presentBases.has(b)).sort()
      : [];

    const extraBases = enabled
      ? Array.from(presentBases).filter((b) => !requiredBases.has(b)).sort()
      : [];

    const requiredSlotKeysByBase = enabled
      ? extractRequiredSlotKeysByBaseFromPuml(objectAnswerPuml)
      : new Map<string, Set<string>>();

    const presentSlotKeysByBase = new Map<string, Set<string>>();

    objects.forEach((o) => {
      if (editingObjectId && o.id === editingObjectId) return;
      if (!o.name?.trim()) return;
      const base = baseNameForAssist(o.name);
      if (!base) return;
      const set = presentSlotKeysByBase.get(base) ?? new Set<string>();
      o.slots.forEach((s) => {
        const k = normalizeSlotKey(s.key);
        if (k) set.add(k);
      });
      presentSlotKeysByBase.set(base, set);
    });

    let requiredSlotKeyTotal = 0;
    let missingSlotKeyTotal = 0;
    let extraSlotKeyTotal = 0;

    const slotDiffs: { base: string; onlyInInput: string[] }[] = [];
    const slotMissingByBase: { base: string; missingInInput: string[] }[] = [];

    for (const [base, reqSet] of requiredSlotKeysByBase.entries()) {
      if (!requiredBases.has(base) || !presentBases.has(base) || !reqSet.size) continue;

      requiredSlotKeyTotal += reqSet.size;
      const presentSet = presentSlotKeysByBase.get(base) ?? new Set<string>();

      const onlyInInput = Array.from(presentSet).filter((k) => !reqSet.has(k)).sort();
      const missingInInput = Array.from(reqSet).filter((k) => !presentSet.has(k)).sort();

      if (onlyInInput.length > 0) {
        extraSlotKeyTotal += onlyInInput.length;
        slotDiffs.push({ base, onlyInInput });
      }

      if (missingInInput.length > 0) {
        missingSlotKeyTotal += missingInInput.length;
        slotMissingByBase.push({ base, missingInInput });
      }
    }

    const matchedSlotKeyTotal = Math.max(0, requiredSlotKeyTotal - missingSlotKeyTotal);

    return {
      enabled,
      requiredBases,
      presentBases,
      missingBases,
      extraBases,
      requiredSlotKeyTotal,
      missingSlotKeyTotal,
      matchedSlotKeyTotal,
      extraSlotKeyTotal,
      slotDiffs,
      slotMissingByBase,
    };
  }, [objects, objectAnswerPuml, editingObjectId]);

  const objSnapshot = objChecked ? objDiagnoseSnapshot : null;

  const objMissingCount = objSnapshot ? objSnapshot.missingCount : objAssist.missingBases.length;
  const objExtraBasesForReveal = objSnapshot ? objSnapshot.extraBases : objAssist.extraBases;
  const objSlotRequiredTotal = objSnapshot ? objSnapshot.slotRequiredTotal : objAssist.requiredSlotKeyTotal;
  const objSlotMissingTotal = objSnapshot ? objSnapshot.slotMissingTotal : objAssist.missingSlotKeyTotal;
  const objSlotMatchedTotal = objSnapshot ? objSnapshot.slotMatchedTotal : objAssist.matchedSlotKeyTotal;
  const objInputTotal = objSnapshot
    ? objSnapshot.inputTotal
    : objects.filter((o) => !!o.name?.trim() && o.id !== editingObjectId).length;
  const objInputMatched = objSnapshot
    ? objSnapshot.inputMatched
    : objects.filter(
        (o) =>
          o.name?.trim() &&
          o.id !== editingObjectId &&
          objAssist.requiredBases.has(baseNameForAssist(o.name))
      ).length;
  const objInputUnmatched = objSnapshot
    ? objSnapshot.inputUnmatched
    : Math.max(0, objInputTotal - objInputMatched);
  const objExtraCount = objSnapshot ? objSnapshot.extraCount : objAssist.extraBases.length;
  const objExtraRevealAllShown =
    objChecked &&
    objExtraBasesForReveal.length > 0 &&
    objRevealExtra >= objExtraBasesForReveal.length;

  const slotDiffsForShow = objSnapshot?.slotDiffs ?? objAssist.slotDiffs;
  const slotOnlyInInputTotalKeys = useMemo(
    () => slotDiffsForShow.reduce((sum, d) => sum + d.onlyInInput.length, 0),
    [slotDiffsForShow]
  );
  const slotDiffTotalKeys = slotOnlyInInputTotalKeys + objSlotMissingTotal;

  const linkAssist = useMemo(() => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);
    const requiredLinks = enabled ? extractLinksFromPuml(objectAnswerPuml) : [];
    const requiredEndpointKeys = new Set(requiredLinks.map((r) => r.endpointKey));

    const presentLinks: LinkSig[] = [];
    links.forEach((l) => {
      const fromObj = objects.find((o) => o.id === l.from);
      const toObj = objects.find((o) => o.id === l.to);
      if (!fromObj?.name || !toObj?.name) return;
      const aBase = baseNameForAssist(fromObj.name);
      const bBase = baseNameForAssist(toObj.name);
      if (!aBase || !bBase) return;
      const label = normalizeLinkLabel(l.label ?? "");
      presentLinks.push({
        a: aBase,
        b: bBase,
        label,
        endpointKey: makeEndpointKey(aBase, bBase),
        fullKey: makeFullKey(makeEndpointKey(aBase, bBase), label),
        pretty: label ? `${aBase} — ${bBase}（${label}）` : `${aBase} — ${bBase}`,
      });
    });

    const presentEndpointKeys = new Set(presentLinks.map((p) => p.endpointKey));

    const missingPretty = enabled
      ? Array.from(requiredEndpointKeys)
          .filter((k) => !presentEndpointKeys.has(k))
          .map((k) => {
            const [x, y] = k.split("||");
            return `${x} — ${y}`;
          })
      : [];

    const extraLinks = enabled
      ? presentLinks
          .filter((p) => !requiredEndpointKeys.has(p.endpointKey))
          .sort((x, y) => x.pretty.localeCompare(y.pretty, "ja"))
      : [];

    return { enabled, requiredEndpointKeys, missingPretty, extraLinks };
  }, [objectAnswerPuml, objects, links]);

  const linkExtraLinksForReveal = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.extraLinks
    : linkAssist.extraLinks;
  const linkExtraCount = linkExtraLinksForReveal.length;
  const linkMissingCount = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.missingCount
    : linkAssist.missingPretty.length;

  const handleObjDiagnose = () => {
    setObjChecked(true);
    setObjTab("diagnose");

    const inputObjs = objects.filter((o) => o.name?.trim() && o.id !== editingObjectId);
    const inputTotal = inputObjs.length;
    const inputMatched = inputObjs.filter((o) =>
      objAssist.requiredBases.has(baseNameForAssist(o.name))
    ).length;
    const inputUnmatched = Math.max(0, inputTotal - inputMatched);

    setObjDiagnoseSnapshot({
      inputTotal,
      inputMatched,
      inputUnmatched,
      requiredCount: objAssist.requiredBases.size,
      missingCount: objAssist.missingBases.length,
      extraCount: objAssist.extraBases.length,
      extraBases: [...objAssist.extraBases],
      slotRequiredTotal: objAssist.requiredSlotKeyTotal,
      slotMissingTotal: objAssist.missingSlotKeyTotal,
      slotMatchedTotal: objAssist.matchedSlotKeyTotal,
      extraSlotCount: objAssist.extraSlotKeyTotal,
      slotDiffs: [...objAssist.slotDiffs],
      slotMissingByBase: [...objAssist.slotMissingByBase],
    });

    setObjRevealExtra(0);
    setObjDirtySinceHint(false);
    setObjRevealMissingHints(false);
    setObjMissingDirtySinceHint(false);
  };

  const handleRequestObjReviewDetails = () => {
    if (!objChecked) return alert("まず「診断」を行ってください。");
    if (
      !objDirtySinceHint &&
      !window.confirm("まだ修正が加えられていません。\nまずは自力で見直してみることをお勧めします。\n\n見直しのヒントを表示しますか？")
    ) return;
    setObjRevealExtra(objExtraBasesForReveal.length);
    setObjDirtySinceHint(false);
    setTimeout(() => {
      objAssistScrollRef.current?.scrollTo({
        top: objAssistScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const handleRequestObjMissingHints = () => {
    if (!objChecked) return alert("まず「診断」を行ってください。");
    if (
      !objMissingDirtySinceHint &&
      !window.confirm("まだ修正が加えられていません。\nまずは自力で見直してみることをお勧めします。\n\n不足に気づくためのヒントを表示しますか？")
    ) return;

    setObjRevealMissingHints(true);
    setObjMissingDirtySinceHint(false);
    setTimeout(() => {
      objAssistScrollRef.current?.scrollTo({
        top: objAssistScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const handleLinkDiagnose = () => {
    setLinkChecked(true);
    setLinkTab("diagnose");

    const presentLinks: LinkSig[] = [];
    links.forEach((l) => {
      const a = baseNameForAssist(objects.find((o) => o.id === l.from)?.name || "");
      const b = baseNameForAssist(objects.find((o) => o.id === l.to)?.name || "");
      if (!a || !b) return;
      const label = normalizeLinkLabel(l.label || "");
      presentLinks.push({
        a,
        b,
        label,
        endpointKey: makeEndpointKey(a, b),
        fullKey: makeFullKey(makeEndpointKey(a, b), label),
        pretty: label ? `${a} — ${b}（${label}）` : `${a} — ${b}`,
      });
    });

    const inputTotal = presentLinks.length;
    const inputMatched = presentLinks.filter((p) =>
      linkAssist.requiredEndpointKeys.has(p.endpointKey)
    ).length;

    setLinkDiagnoseSnapshot({
      inputTotal,
      inputMatched,
      inputUnmatched: Math.max(0, inputTotal - inputMatched),
      requiredCount: linkAssist.requiredEndpointKeys.size,
      missingCount: linkAssist.missingPretty.length,
      extraCount: linkAssist.extraLinks.length,
      extraLinks: linkAssist.extraLinks,
    });

    setLinkRevealExtra(0);
    setLinkDirtySinceHint(false);
    setLinkRevealMissingHints(false);
    setLinkMissingDirtySinceHint(false);
  };

  const handleRequestLinkReviewDetails = () => {
    if (!linkChecked) return alert("まず「診断」を行ってください。");
    if (
      !linkDirtySinceHint &&
      !window.confirm("まだ修正が加えられていません。\nまずは自力で見直してみることをお勧めします。\n\n見直しのヒントを表示しますか？")
    ) return;

    setLinkRevealExtra(linkExtraLinksForReveal.length);
    setLinkDirtySinceHint(false);
    setTimeout(() => {
      linkAssistScrollRef.current?.scrollTo({
        top: linkAssistScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const handleRequestLinkMissingHints = () => {
    if (!linkChecked) return alert("まず「診断」を行ってください。");
    if (
      !linkMissingDirtySinceHint &&
      !window.confirm("まだ修正が加えられていません。\nまずは自力で見直してみることをお勧めします。\n\n不足に気づくためのヒントを表示しますか？")
    ) return;

    setLinkRevealMissingHints(true);
    setLinkMissingDirtySinceHint(false);
    setTimeout(() => {
      linkAssistScrollRef.current?.scrollTo({
        top: linkAssistScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const handleAddObject = () => {
    const id = makeId();
    setObjects((prev) => [...prev, { id, name: "", slots: [] }]);
    setSelectedObjectId(id);
    setSelectedLinkId(null);
    markMeaningfulChange(true, true);
  };

  const handleDuplicateObject = (id: string) => {
    const target = objects.find((o) => o.id === id);
    if (!target) return;
    const newId = makeId();
    const newName = target.name ? `${target.name}_コピー` : "名称未設定_コピー";
    const newObj: Obj = {
      id: newId,
      name: newName,
      slots: target.slots.map((s) => ({ ...s })),
    };
    setObjects((prev) => [...prev, newObj]);
    setSelectedObjectId(newId);
    setSelectedLinkId(null);
    markMeaningfulChange(true, true);
  };

  const handleUpdateObjectName = (id: string, newName: string) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, name: newName } : o)));
    markMeaningfulChange(true, true);
  };

  const handleDeleteObject = (id: string) => {
    if (!window.confirm("このオブジェクトを削除しますか？")) return;
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setLinks((prev) => prev.filter((l) => l.from !== id && l.to !== id));
    if (selectedObjectId === id) setSelectedObjectId(null);
    markMeaningfulChange(true, true);
  };

  const handleAddSlotToSelected = () => {
    if (!selectedObject) return;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selectedObject.id
          ? { ...o, slots: [...o.slots, { key: "", value: "" }] }
          : o
      )
    );
    markMeaningfulChange(true, false);
  };

  const handleUpdateSlot = (index: number, partial: Partial<Slot>) => {
    if (!selectedObject) return;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selectedObject.id
          ? { ...o, slots: o.slots.map((s, i) => (i === index ? { ...s, ...partial } : s)) }
          : o
      )
    );
    markMeaningfulChange(true, false);
  };

  const handleDeleteSlot = (index: number) => {
    if (!selectedObject) return;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selectedObject.id
          ? { ...o, slots: o.slots.filter((_, i) => i !== index) }
          : o
      )
    );
    markMeaningfulChange(true, false);
  };

  const handleAddLink = () => {
    if (objects.length < 2) return alert("オブジェクトを2つ以上作成してください");
    const id = makeId();
    setLinks((prev) => [
      ...prev,
      { id, from: objects[0].id, to: objects[1].id, label: "" },
    ]);
    setSelectedLinkId(id);
    setSelectedObjectId(null);
    markMeaningfulChange(false, true);
  };

  const handleUpdateLink = (id: string, partial: Partial<Link>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...partial } : l)));
    markMeaningfulChange(false, true);
  };

  const handleDeleteLink = (id: string) => {
    if (!window.confirm("このリンクを削除しますか？")) return;
    setLinks((prev) => prev.filter((l) => l.id !== id));
    if (selectedLinkId === id) setSelectedLinkId(null);
    markMeaningfulChange(false, true);
  };

  const handleSaveState = () => {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    alert("保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return alert("保存データがありません。");
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      setObjects(parsed.objects ?? []);
      setLinks(parsed.links ?? []);
      setObjChecked(false);
      setLinkChecked(false);
      alert("復元しました。");
    } catch {}
  };

  const handleClearAll = () => {
    if (!window.confirm("すべて削除しますか？")) return;
    setObjects([]);
    setLinks([]);
    setObjChecked(false);
    setLinkChecked(false);
  };

  const handleConvertAndOpenClassEditor = async () => {
    if (hasUnnamedObject) {
      alert("インスタンス名が未入力のものがあります。");
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    } catch {}

    const hasUncheckedOrMismatch =
      !objChecked ||
      !linkChecked ||
      objExtraCount > 0 ||
      objMissingCount > 0 ||
      linkExtraCount > 0 ||
      linkMissingCount > 0 ||
      slotDiffTotalKeys > 0;

    if (hasUncheckedOrMismatch) {
      const ok = window.confirm(
        "未診断、または診断で確認事項が残っています。\nこのままクラス図編集ページへ進みますか？"
      );
      if (!ok) return;
    }

    let result: ConvertResponse | null = null;

    if (classPuml) {
      const solid = forceSolidRelations(classPuml);
      let encoded = "";
      try {
        encoded = plantumlEncoder.encode(solid);
      } catch {
        encoded = encodedClassPuml || "";
      }

      result = {
        classPuml: solid,
        encodedPuml: encoded,
        issues: issues ?? undefined,
        relationHints,
        inheritanceCandidates,
      };
    } else {
      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objects: objects.map((o) => ({
              name: o.name,
              attrs: o.slots.map((s) => ({ key: s.key, value: s.value })),
            })),
            links: links.map((l) => ({
              from: objects.find((o) => o.id === l.from)?.name ?? "",
              to: objects.find((o) => o.id === l.to)?.name ?? "",
              label: l.label,
            })),
          }),
        });

        if (!res.ok) {
          alert("クラス図への変換でエラーが発生しました。");
          return;
        }

        const data = (await res.json()) as ConvertResponse;
        const solid = forceSolidRelations(data.classPuml);
        let encoded = "";
        try {
          encoded = plantumlEncoder.encode(solid);
        } catch {
          encoded = data.encodedPuml || "";
        }

        setClassPuml(solid);
        setEncodedClassPuml(encoded);
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);
        setInheritanceCandidates(data.inheritanceCandidates ?? []);

        result = {
          ...data,
          classPuml: solid,
          encodedPuml: encoded,
        };
      } catch (e) {
        console.error(e);
        alert("クラス図への変換で予期しないエラーが発生しました。");
        return;
      }
    }

    if (!result) return;

    const editorPayload: EditorPayload = {
      initialClassPuml: result.classPuml,
      relationHints: result.relationHints ?? [],
      inheritanceCandidates: result.inheritanceCandidates ?? [],
      snapshot: { objects, links },
    };

    try {
      localStorage.setItem(STORAGE_KEY_EDITOR_INITIAL, JSON.stringify(editorPayload));
    } catch {}

    router.push("/experiment/class-editor");
  };

  const displayClassPuml = useMemo(
    () => sanitizeClassPumlForLearner(forceSolidRelations(classPuml)),
    [classPuml]
  );

  const displayEncodedClassPuml = useMemo(() => {
    try {
      return displayClassPuml ? plantumlEncoder.encode(displayClassPuml) : "";
    } catch {
      return "";
    }
  }, [displayClassPuml]);

  const objectPreviewUrl = encodedObjectPuml
    ? `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}`
    : "";

  const classPreviewUrl = displayEncodedClassPuml
    ? `https://www.plantuml.com/plantuml/svg/${displayEncodedClassPuml}`
    : "";

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex gap-3">
          <button
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition"
            onClick={handleClearAll}
          >
            クリア
          </button>
          <button
            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded transition"
            onClick={handleLoadState}
          >
            復元
          </button>
          <button
            className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded transition"
            onClick={handleSaveState}
          >
            保存
          </button>
        </div>
        <button
          className="px-5 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition shadow-sm"
          onClick={handleConvertAndOpenClassEditor}
          disabled={hasUnnamedObject}
        >
          クラス図編集へ進む
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 min-w-[280px] bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm text-slate-800">要求文（問題）</h2>
              <button
                className="text-xs text-slate-500 hover:text-slate-800 underline decoration-slate-300"
                onClick={() => setShowObjectProblemFull(!showObjectProblemFull)}
              >
                {showObjectProblemFull ? "折りたたむ" : "すべて表示"}
              </button>
            </div>
            <div
              className={`text-[12px] leading-relaxed text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 ${
                !showObjectProblemFull && "max-h-[150px] overflow-hidden relative"
              }`}
            >
              {objectProblemText || "問題文がありません。"}
              {!showObjectProblemFull && (
                <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-slate-50 to-transparent" />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col border-r border-slate-200 bg-slate-50/50">
          <div
            style={{ height: `${objPanelRatio}%` }}
            className="flex flex-col min-h-[20%] max-h-[80%] bg-white relative overflow-hidden border-b border-slate-200"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center p-1 bg-slate-200/60 rounded-md gap-1">
                <button
                  onClick={() => setObjTab("edit")}
                  className={`px-4 py-1 text-xs font-semibold rounded ${
                    objTab === "edit"
                      ? "bg-white shadow-sm text-slate-800"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  エディタ
                </button>
                <button
                  onClick={() => setObjTab("diagnose")}
                  className={`px-4 py-1 text-xs font-semibold rounded ${
                    objTab === "diagnose"
                      ? "bg-white shadow-sm text-indigo-700"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  診断結果
                </button>
              </div>
              {objTab === "edit" ? (
                <button
                  className="px-3 py-1 text-xs font-medium bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition"
                  onClick={handleAddObject}
                >
                  ＋ オブジェクト追加
                </button>
              ) : (
                <button
                  className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 transition shadow-sm"
                  onClick={handleObjDiagnose}
                >
                  診断を再実行
                </button>
              )}
            </div>

            <div className="flex flex-1 overflow-hidden min-h-0">
              {objTab === "edit" ? (
                <>
                  <div className="w-1/2 overflow-y-auto overflow-x-hidden border-r border-slate-100 bg-slate-50/30">
                    <div className="p-3 pb-6">
                      {objects.map((o) => (
                        <div
                          key={o.id}
                          onClick={() => {
                            setSelectedObjectId(o.id);
                            setSelectedLinkId(null);
                          }}
                          className={`p-3 mb-2 rounded-lg cursor-pointer transition border ${
                            selectedObjectId === o.id
                              ? "bg-white border-indigo-300 shadow-sm ring-1 ring-indigo-100"
                              : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="font-medium text-sm text-slate-800">
                            {o.name || "名称未設定"}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {o.slots.length} スロット
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="w-1/2 overflow-y-auto overflow-x-hidden bg-white">
                    <div className="p-4 pb-8">
                      {selectedObject ? (
                        <div className="space-y-4">
                          <div>
                            <label className="text-xs font-bold text-slate-700 mb-1 flex items-center">
                              インスタンス名 <HelpBadge title={TOOLTIP.objectName} />
                            </label>
                            <input
                              className="w-full min-w-0 px-3 py-2 border border-slate-300 rounded-md text-sm"
                              value={selectedObject.name}
                              onChange={(e) =>
                                handleUpdateObjectName(selectedObject.id, e.target.value)
                              }
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-bold text-slate-700 flex items-center">
                                スロット <HelpBadge title={TOOLTIP.slotKey} />
                              </label>
                              <button
                                className="text-xs text-indigo-600 hover:underline font-medium"
                                onClick={handleAddSlotToSelected}
                              >
                                ＋ スロット追加
                              </button>
                            </div>
                            <div className="space-y-2">
                              {selectedObject.slots.map((s, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 p-2 rounded-md border border-slate-200 bg-slate-50/50 shadow-sm w-full"
                                >
                                  <input
                                    className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded bg-white"
                                    placeholder="名前"
                                    value={s.key}
                                    onChange={(e) => handleUpdateSlot(i, { key: e.target.value })}
                                  />
                                  <span className="text-slate-400 text-xs flex-shrink-0">=</span>
                                  <input
                                    className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded bg-white"
                                    placeholder="値"
                                    value={s.value}
                                    onChange={(e) => handleUpdateSlot(i, { value: e.target.value })}
                                  />
                                  <button
                                    className="text-slate-400 hover:text-red-500 px-1 text-lg leading-none flex-shrink-0"
                                    onClick={() => handleDeleteSlot(i)}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-4 border-t border-slate-100 flex justify-end gap-4">
                            <button
                              className="text-xs text-indigo-600 hover:underline font-medium"
                              onClick={() => handleDuplicateObject(selectedObject.id)}
                            >
                              このオブジェクトを複製
                            </button>
                            <button
                              className="text-xs text-red-500 hover:underline font-medium"
                              onClick={() => handleDeleteObject(selectedObject.id)}
                            >
                              このオブジェクトを削除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400 text-center mt-10">
                          左のリストからオブジェクトを選択してください
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50"
                  ref={objAssistScrollRef}
                >
                  <div className="p-6 pb-12">
                    {!objChecked ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <p className="text-sm mb-4">まだ診断が実行されていません。</p>
                        <button
                          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm shadow-sm hover:bg-indigo-700 transition"
                          onClick={handleObjDiagnose}
                        >
                          診断を実行する
                        </button>
                      </div>
                    ) : (
                      <div className="max-w-2xl mx-auto space-y-6">
                        <DiagnoseGroupCard
                          title="不足しているもの"
                          tone="missing"
                          count={objMissingCount + objSlotMissingTotal + linkMissingCount}
                          summary="まだ追加できていない対象・情報・関係があります。"
                          detailLabel="不足に気づくヒントを見る"
                          onDetail={handleRequestObjMissingHints}
                          disabled={
                            objMissingCount + objSlotMissingTotal + linkMissingCount === 0 ||
                            (!objMissingDirtySinceHint && objRevealMissingHints)
                          }
                        >
                          <div className="flex flex-wrap gap-2">
                            <CountBadge label="インスタンス不足" value={objMissingCount} />
                            <CountBadge label="スロット不足" value={objSlotMissingTotal} />
                            
                          </div>
                        </DiagnoseGroupCard>

                        <DiagnoseGroupCard
                          title="見直したいもの"
                          tone="review"
                          count={objExtraCount + slotOnlyInInputTotalKeys}
                          summary="入っているが、問題文との対応を見直した方がよいものがあります。"
                          detailLabel="見直しのヒントを見る"
                          onDetail={handleRequestObjReviewDetails}
                          disabled={
                            objExtraCount + slotOnlyInInputTotalKeys === 0 ||
                            (!objDirtySinceHint && objExtraRevealAllShown)
                          }
                        />

                        {objRevealMissingHints && (
                          <div className="p-4 bg-white border-l-4 border-amber-400 rounded shadow-sm transition-all duration-300 space-y-4">
                            <div className="flex flex-wrap gap-2">
                              <CountBadge label="インスタンス不足" value={objMissingCount} />
                              <CountBadge label="スロット不足" value={objSlotMissingTotal} />
                            </div>

                            {objMissingCount > 0 && (
                              <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">
                                  ➕ インスタンスについてのヒント
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed">
                                  問題文に出てくる対象が、まだ図に十分表せていない可能性があります。
                                  <br />
                                  人だけでなく、管理対象・予約対象・関係の相手にも注目してみましょう。
                                </div>
                              </div>
                            )}

                            {objSlotMissingTotal > 0 && (
                              <div className={objMissingCount > 0 ? "pt-3 border-t border-slate-100" : ""}>
                                <div className="text-xs font-bold text-slate-700 mb-2">
                                  ➕ 情報についてのヒント
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed">
                                  いくつかのインスタンスで、持つべき情報がまだそろっていない可能性があります。
                                  <br />
                                  問題文の「〜は、…をもつ」「〜番号」「氏名」「連絡先」などの表現を見直してみましょう。
                                </div>
                                <div className="mt-2 text-[11px] text-slate-500">
                                  一致: {objSlotMatchedTotal} / 必要: {objSlotRequiredTotal} / 不足: {objSlotMissingTotal}
                                </div>
                              </div>
                            )}

                            {linkMissingCount > 0 && (
                              <div className={(objMissingCount > 0 || objSlotMissingTotal > 0) ? "pt-3 border-t border-slate-100" : ""}>
                                <div className="text-xs font-bold text-slate-700 mb-2">
                                  ➕ スロットについてのヒント
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed">
                                  まだ図に表せていない関係がある可能性があります。
                                  <br />
                                  問題文の「担当する」「予約している」「所有する」「対応する」など、
                                  2つの対象を結ぶ表現がないかを確認してみましょう。
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {objRevealExtra > 0 && (
                          <div className="p-4 bg-white border-l-4 border-rose-400 rounded shadow-sm transition-all duration-300 space-y-4">
                            {objExtraCount > 0 && (
                              <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">
                                  🔍 このインスタンス名を見直しましょう
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {objExtraBasesForReveal.map((b) => (
                                    <span
                                      key={b}
                                      className="px-2 py-1 bg-rose-50 text-rose-700 text-xs rounded border border-rose-100"
                                    >
                                      {b}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {slotDiffsForShow.length > 0 && (
                              <div className={objExtraCount > 0 ? "pt-3 border-t border-slate-100" : ""}>
                                <div className="text-xs font-bold text-slate-700 mb-2">
                                  🔍 この対象の情報を見直しましょう
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {slotDiffsForShow.map((d) => (
                                    <span
                                      key={d.base}
                                      className="px-2 py-1 bg-rose-50 text-rose-700 text-xs rounded border border-rose-100"
                                    >
                                      {d.base}
                                    </span>
                                  ))}
                                </div>
                                <div className="mt-2 text-[11px] text-slate-500">
                                  どのスロット名がずれているかは表示せず、対象だけ示しています。
                                </div>
                              </div>
                            )}

                            <div className="text-[11px] text-slate-500">
                              入力インスタンス: {objInputTotal} / 一致: {objInputMatched} / 見直し候補: {objInputUnmatched}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              className="absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize bg-slate-200 hover:bg-indigo-300 transition z-20"
              onMouseDown={(e) => {
                const startY = e.clientY;
                const startRatio = objPanelRatio;
                const onMouseMove = (moveEvent: MouseEvent) => {
                  const delta = ((moveEvent.clientY - startY) / window.innerHeight) * 100;
                  setObjPanelRatio(Math.min(80, Math.max(20, startRatio + delta)));
                };
                const onMouseUp = () => {
                  document.removeEventListener("mousemove", onMouseMove);
                  document.removeEventListener("mouseup", onMouseUp);
                };
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
              }}
            />
          </div>

          <div className="flex-1 flex flex-col min-h-[20%] bg-slate-100 overflow-hidden relative">
            <div className="absolute top-2 right-4 z-10 flex gap-2 bg-white/90 p-1.5 rounded shadow-sm border border-slate-200 backdrop-blur">
              <span className="text-xs font-bold text-slate-600 py-1 px-2">プレビュー</span>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.1}
                value={objectZoom}
                onChange={(e) => setObjectZoom(parseFloat(e.target.value))}
                className="w-24"
              />
              <span className="text-xs w-10 text-center">{Math.round(objectZoom * 100)}%</span>
            </div>

            <div
              className={`flex-1 overflow-auto p-4 ${objectPan.isDragging ? "cursor-grabbing" : "cursor-grab"}`}
              ref={objectPan.containerRef}
              {...objectPan.handlers}
            >
              {objectPreviewUrl ? (
                <div style={{ transform: `scale(${objectZoom})`, transformOrigin: "top left", width: "max-content" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={objectPreviewUrl} alt="オブジェクト図" className="pointer-events-none select-none drop-shadow-sm" />
                </div>
              ) : (
                <div className="text-slate-400 text-sm text-center mt-10">図がありません</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-slate-50/50">
          <div
            style={{ height: `${linkPanelRatio}%` }}
            className="flex flex-col min-h-[20%] max-h-[80%] bg-white relative overflow-hidden border-b border-slate-200"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center p-1 bg-slate-200/60 rounded-md gap-1">
                <button
                  onClick={() => setLinkTab("edit")}
                  className={`px-4 py-1 text-xs font-semibold rounded ${
                    linkTab === "edit"
                      ? "bg-white shadow-sm text-slate-800"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  エディタ
                </button>
                <button
                  onClick={() => setLinkTab("diagnose")}
                  className={`px-4 py-1 text-xs font-semibold rounded ${
                    linkTab === "diagnose"
                      ? "bg-white shadow-sm text-indigo-700"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  診断結果
                </button>
              </div>

              {linkTab === "edit" ? (
                <button
                  className="px-3 py-1 text-xs font-medium bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition"
                  onClick={handleAddLink}
                >
                  ＋ リンク追加
                </button>
              ) : (
                <button
                  className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 transition shadow-sm"
                  onClick={handleLinkDiagnose}
                >
                  診断を再実行
                </button>
              )}
            </div>

            <div className="flex flex-1 overflow-hidden min-h-0">
              {linkTab === "edit" ? (
                <>
                  <div className="w-1/2 overflow-y-auto overflow-x-hidden border-r border-slate-100 bg-slate-50/30">
                    <div className="p-3 pb-6">
                      {links.map((l) => (
                        <div
                          key={l.id}
                          onClick={() => {
                            setSelectedLinkId(l.id);
                            setSelectedObjectId(null);
                          }}
                          className={`p-3 mb-2 rounded-lg cursor-pointer transition border ${
                            selectedLinkId === l.id
                              ? "bg-white border-indigo-300 shadow-sm ring-1 ring-indigo-100"
                              : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="text-xs font-medium text-slate-700 truncate">
                            {objects.find((o) => o.id === l.from)?.name || "?"} ー {objects.find((o) => o.id === l.to)?.name || "?"}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1.5 bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                            {l.label || "ラベルなし"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="w-1/2 overflow-y-auto overflow-x-hidden bg-white">
                    <div className="p-4 pb-8">
                      {selectedLink ? (
                        <div className="space-y-5">
                          <div>
                            <label className="text-xs font-bold text-slate-700 mb-1.5 flex items-center">
                              接続先 <HelpBadge title={TOOLTIP.linkEndpoints} />
                            </label>
                            <div className="flex items-center gap-2">
                              <select
                                className="flex-1 min-w-0 text-xs px-2 py-2 border border-slate-300 rounded-md"
                                value={selectedLink.from}
                                onChange={(e) => handleUpdateLink(selectedLink.id, { from: e.target.value })}
                              >
                                {objects.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                              <span className="text-slate-400 flex-shrink-0 font-bold">ー</span>
                              <select
                                className="flex-1 min-w-0 text-xs px-2 py-2 border border-slate-300 rounded-md"
                                value={selectedLink.to}
                                onChange={(e) => handleUpdateLink(selectedLink.id, { to: e.target.value })}
                              >
                                {objects.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-bold text-slate-700 mb-1.5 flex items-center">
                              リンクラベル <HelpBadge title={TOOLTIP.linkLabel} />
                            </label>
                            <input
                              className="w-full min-w-0 text-xs px-3 py-2 border border-slate-300 rounded-md"
                              placeholder="関係を示す言葉"
                              value={selectedLink.label}
                              onChange={(e) => handleUpdateLink(selectedLink.id, { label: e.target.value })}
                            />
                          </div>

                          <div className="pt-4 border-t border-slate-100 flex justify-end">
                            <button
                              className="text-xs text-red-500 hover:underline font-medium"
                              onClick={() => handleDeleteLink(selectedLink.id)}
                            >
                              このリンクを削除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400 text-center mt-10">
                          左のリストからリンクを選択してください
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50"
                  ref={linkAssistScrollRef}
                >
                  <div className="p-6 pb-12">
                    {!linkChecked ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <p className="text-sm mb-4">まだ診断が実行されていません。</p>
                        <button
                          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm shadow-sm hover:bg-indigo-700 transition"
                          onClick={handleLinkDiagnose}
                        >
                          診断を実行する
                        </button>
                      </div>
                    ) : (
                      <div className="max-w-2xl mx-auto space-y-6">
                        <DiagnoseGroupCard
                          title="不足しているもの"
                          tone="missing"
                          count={linkMissingCount}
                          summary="まだ追加できていない関係があります。"
                          detailLabel="不足に気づくヒントを見る"
                          onDetail={handleRequestLinkMissingHints}
                          disabled={
                            linkMissingCount === 0 ||
                            (!linkMissingDirtySinceHint && linkRevealMissingHints)
                          }
                        >
                          <div className="flex flex-wrap gap-2">
                            <CountBadge label="リンク不足" value={linkMissingCount} />
                          </div>
                        </DiagnoseGroupCard>

                        <DiagnoseGroupCard
                          title="見直したいもの"
                          tone="review"
                          count={linkExtraCount}
                          summary="入っているが、つなぎ方を見直した方がよい関係があります。"
                          detailLabel="見直しのヒントを見る"
                          onDetail={handleRequestLinkReviewDetails}
                          disabled={
                            linkExtraCount === 0 ||
                            (!linkDirtySinceHint &&
                              linkRevealExtra >= linkExtraLinksForReveal.length)
                          }
                        />

                        {linkRevealMissingHints && (
                          <div className="p-4 bg-white border-l-4 border-amber-400 rounded shadow-sm transition-all duration-300 space-y-4">
                            <div className="flex flex-wrap gap-2">
                              <CountBadge label="リンク不足" value={linkMissingCount} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-700 mb-2">
                                ➕ 関係についてのヒント
                              </div>
                              <div className="text-sm text-slate-700 leading-relaxed">
                                まだ図に表せていない関係がある可能性があります。
                                <br />
                                問題文の「担当する」「予約している」「所有する」「対応する」など、
                                2つの対象を結ぶ表現がないかを確認してみましょう。
                              </div>
                            </div>
                          </div>
                        )}

                        {linkRevealExtra > 0 && (
                          <div className="p-4 bg-white border-l-4 border-rose-400 rounded shadow-sm transition-all duration-300">
                            <div className="text-xs font-bold text-slate-700 mb-2">
                              🔍 この対象どうしの関係を見直しましょう
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {Array.from(
                                new Set(linkExtraLinksForReveal.flatMap((p) => [p.a, p.b]).filter(Boolean))
                              ).map((base) => (
                                <span
                                  key={base}
                                  className="px-2 py-1 bg-rose-50 text-rose-700 text-xs rounded border border-rose-100"
                                >
                                  {base}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 text-[11px] text-slate-500">
                              不自然なリンクの具体名は直接出さず、対象だけ示しています。
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              className="absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize bg-slate-200 hover:bg-indigo-300 transition z-20"
              onMouseDown={(e) => {
                const startY = e.clientY;
                const startRatio = linkPanelRatio;
                const onMouseMove = (moveEvent: MouseEvent) => {
                  const delta = ((moveEvent.clientY - startY) / window.innerHeight) * 100;
                  setLinkPanelRatio(Math.min(80, Math.max(20, startRatio + delta)));
                };
                const onMouseUp = () => {
                  document.removeEventListener("mousemove", onMouseMove);
                  document.removeEventListener("mouseup", onMouseUp);
                };
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
              }}
            />
          </div>

          <div className="flex-1 flex flex-col min-h-[20%] bg-slate-100 overflow-hidden relative">
            <div className="absolute top-2 left-4 z-10 flex items-center gap-2">
              <div className="flex gap-2 bg-white/90 p-1.5 rounded shadow-sm border border-slate-200 backdrop-blur">
                <button
                  type="button"
                  className="px-3 py-1 text-xs font-semibold rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowInheritanceHint((v) => !v)}
                >
                  継承のヒント
                </button>
                <span className="px-2 py-1 text-[11px] text-slate-500">
                  {inheritanceStrong.length + inheritanceWeak.length}件
                </span>
              </div>

              {showInheritanceHint && (
                <div className="w-[320px] max-w-[42vw] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-800">継承のヒント</div>
                      <div className="mt-1 text-[12px] text-slate-500">
                        この画面では決めずに、次のページで確認します。
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      onClick={() => setShowInheritanceHint(false)}
                    >
                      閉じる
                    </button>
                  </div>

                  {featuredInheritance ? (
                    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                      <div className="text-xs font-semibold text-indigo-800">まず見る候補</div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">
                        {featuredInheritance.children.join(" / ")}
                      </div>
                      <div className="mt-2 text-xs text-slate-700">
                        共通属性: {featuredInheritance.sharedAttrs.join("、")}
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        共通部分を親クラスにまとめられるか、次のページで確認しましょう。
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      今回の入力では、継承を強く考える候補は見つかっていません。
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="absolute top-2 right-4 z-10 flex gap-2 bg-white/90 p-1.5 rounded shadow-sm border border-slate-200 backdrop-blur">
              <span className="text-xs font-bold text-slate-600 py-1 px-2">自動生成クラス図</span>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.1}
                value={classZoom}
                onChange={(e) => setClassZoom(parseFloat(e.target.value))}
                className="w-24"
              />
              <span className="text-xs w-10 text-center">{Math.round(classZoom * 100)}%</span>
            </div>

            <div
              className={`flex-1 overflow-auto p-4 pt-16 ${classPan.isDragging ? "cursor-grabbing" : "cursor-grab"}`}
              ref={classPan.containerRef}
              {...classPan.handlers}
            >
              {classPreviewUrl ? (
                <div style={{ transform: `scale(${classZoom})`, transformOrigin: "top left", width: "max-content" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={classPreviewUrl} alt="クラス図" className="pointer-events-none select-none drop-shadow-sm" />
                </div>
              ) : (
                <div className="text-slate-400 text-sm text-center mt-10">
                  オブジェクト名を入力してください
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExperimentPage;
