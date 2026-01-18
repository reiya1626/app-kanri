// app/experiment/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../components/problem-config";

// ===== 型定義 =====
type Slot = {
  key: string;
  value: string;
};

type Obj = {
  id: string;
  name: string;
  slots: Slot[];
};

// 「オブジェクトを診断する」を押した時点の結果を固定表示するためのスナップショット
type ObjDiagnoseSnapshot = {
  // 入力側（学習者が作成した要素）を基準にした見せ方（A案）
  inputTotal: number; // 名前が入っている入力オブジェクト数
  inputMatched: number; // 入力のうち正答例に含まれる（オブジェクト名一致）数
  inputUnmatched: number; // 入力のうち正答例に含まれない数

  // 正答側（不足）
  requiredCount: number;
  missingCount: number;
  extraCount: number;
  extraBases: string[];
  slotRequiredTotal: number;
  slotMissingTotal: number;
  slotMatchedTotal: number;
  extraSlotCount: number;
};

// 「リンクを診断する」を押した時点の結果を固定表示するためのスナップショット
type LinkDiagnoseSnapshot = {
  // 入力側（学習者が作成した要素）を基準にした見せ方（A案）
  inputTotal: number; // 入力リンク数（端点が有効なもの）
  inputMatched: number; // 入力のうち正答例に含まれる（端点一致）数
  inputUnmatched: number; // 入力のうち正答例に含まれない数

  // 正答側（不足）
  requiredCount: number;
  missingCount: number;
  extraCount: number;
  extraLinks: LinkSig[];
  labelWarnings: { pretty: string; expected: string[]; actual: string }[];
};

type Link = {
  id: string;
  from: string; // Obj.id
  to: string; // Obj.id
  label: string;
};

type IssuesResponse = {
  classes: {
    name: string;
    incomplete: string[];
    contradictory: string[];
  }[];
};

type RelationHint = {
  fromClass: string;
  toClass: string;
  candidates: { label: string; count: number }[];
};

type ConvertResponse = {
  classPuml: string;
  encodedPuml: string;
  issues?: IssuesResponse;
  relationHints?: RelationHint[];
};

type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  snapshot?: {
    objects: Obj[];
    links: Link[];
  };
};

const STORAGE_KEY_STATE = "EXPERIMENT_OBJECT_EDITOR_STATE";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// ===== ユーティリティ（オブジェクト図用フォーマット） =====
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

// ===== 型（学習者向け表記） =====
const TYPE_LEGEND_TOOLTIP =
  "【属性型の見方】\n" +
  "string = 文字列（例：\"佐藤\"）\n" +
  "int = 整数（例：1001）\n" +
  "real = 小数（例：3.14）\n" +
  "boolean = 真偽値（true / false）\n" +
  "型混在 = 同じ属性に複数の型が混ざっています（要確認）";

const explainTypeText = (raw: string) => {
  return (raw ?? "")
    .replace(/\bstring\b/g, "文字列")
    .replace(/\bint\b/g, "整数")
    .replace(/\breal\b/g, "小数")
    .replace(/\bboolean\b/g, "真偽値");
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

/**
 * 推定クラス図の関連が点線(..)で出てくる場合があるため、
 * 関連オペレータ（.. / ..> / <.. / ..|> など）だけを実線（--）系に強制変換する。
 * ※ "0..*" 等の多重度（引用符つき）はトークン判定で除外される
 */
const forceSolidRelations = (puml: string) => {
  if (!puml) return puml;
  const lines = puml.split(/\r?\n/);

  const shouldSkipLine = (t: string) => {
    if (!t) return true;
    if (t.startsWith("'")) return true;
    if (
      /^(?:@startuml|@enduml|skinparam|hide|show|title|left to right direction)\b/i.test(
        t
      )
    )
      return true;
    return false;
  };

  const isRelationOpToken = (tok: string) => {
    return /^[.\-o*<>()\/\\|><]+$/.test(tok) && tok.includes(".");
  };

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

// ===== OD作成アシスト（パターン1/4） =====
const stripHtmlTags = (s: string) => s.replace(/<[^>]*>/g, "");

const normalizeObjectLabel = (raw: string) => {
  const noTags = stripHtmlTags(raw).trim();
  const left = noTags.includes(":") ? noTags.split(":")[0].trim() : noTags;
  return left.replace(/^"+|"+$/g, "").trim();
};

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
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "");
  return t;
};

const normalizeSlotKey = (raw: string) => {
  return stripHtmlTags(raw ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "");
};

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

  const reQuoted =
    /^\s*object\s+"([^"]+)"(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

  const reBare =
    /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("'")) continue;

    const m1 = line.match(reQuoted);
    if (m1?.[1]) {
      labels.push(m1[1]);
      continue;
    }
    const m2 = line.match(reBare);
    if (m2?.[1]) {
      labels.push(m2[1]);
      continue;
    }
  }

  return labels
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\.+$/.test(s));
};

const extractAliasToBaseFromPuml = (puml: string) => {
  const map = new Map<string, string>();
  if (!puml) return map;

  const lines = puml.split(/\r?\n/);

  const reQuoted =
    /^\s*object\s+"([^"]+)"\s+as\s+([\w.\-]+)(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

  const reBare =
    /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)\s+as\s+([\w.\-]+)(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("'")) continue;

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

  const reObjQuoted =
    /^\s*object\s+"([^"]+)"(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

  const reObjBare =
    /^\s*object\s+([\wぁ-んァ-ン一-龥ー]+)(?:\s+as\s+[\w.\-]+)?(?:\s+#[A-Za-z0-9]+)?(?:\s*\{)?\s*$/i;

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
    if (!t) continue;
    if (t.startsWith("'")) continue;

    const m1 = rawLine.match(reObjQuoted);
    const m2 = rawLine.match(reObjBare);
    if (m1?.[1] || m2?.[1]) {
      const label = (m1?.[1] ?? m2?.[1] ?? "").trim();
      const base = baseNameForAssist(label);
      if (!base) {
        currentBase = null;
        inBlock = false;
        pendingBase = null;
        continue;
      }

      if (t.includes("{")) {
        startBlock(base);
      } else {
        pendingBase = base;
        currentBase = null;
        inBlock = false;
      }
      continue;
    }

    if (!inBlock && pendingBase && t === "{") {
      startBlock(pendingBase);
      continue;
    }

    if (inBlock) {
      if (t === "}") {
        endBlock();
        continue;
      }
      if (t === "{") continue;

      const keyPart = extractSlotKeyFromPumlLine(t);
      const key = normalizeSlotKey(keyPart);
      if (!key) continue;

      const set = map.get(currentBase!);
      if (set) set.add(key);
      continue;
    }
  }

  return map;
};

type LinkSig = {
  a: string;
  b: string;
  label: string;
  endpointKey: string;
  fullKey: string;
  pretty: string;
};

const makeEndpointKey = (aBase: string, bBase: string) => {
  const x = aBase <= bBase ? aBase : bBase;
  const y = aBase <= bBase ? bBase : aBase;
  return `${x}||${y}`;
};

const makeFullKey = (endpointKey: string, labelNorm: string) =>
  `${endpointKey}||${labelNorm}`;

const extractLinksFromPuml = (puml: string) => {
  const out: LinkSig[] = [];
  if (!puml) return out;

  const aliasToBase = extractAliasToBaseFromPuml(puml);
  const lines = puml.split(/\r?\n/);

  const reRel =
    /^\s*([\w.\-ぁ-んァ-ン一-龥ー]+)\s*[-.o*<>()\/\\]+?\s*([\w.\-ぁ-んァ-ン一-龥ー]+)\s*(?::\s*(.+))?\s*$/;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("'")) continue;
    if (
      /^(?:@startuml|@enduml|skinparam|hide|title|left to right direction)/i.test(
        t
      )
    )
      continue;
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

    const pretty = label
      ? `${aBase} — ${bBase}（${label}）`
      : `${aBase} — ${bBase}`;

    out.push({ a: aBase, b: bBase, label, endpointKey, fullKey, pretty });
  }

  const uniq = new Map<string, LinkSig>();
  for (const l of out) {
    if (!uniq.has(l.fullKey)) uniq.set(l.fullKey, l);
  }
  return Array.from(uniq.values());
};

// ===== 用語説明（title用） =====
const TOOLTIP = {
  objectName:
    "【インスタンス名】現実世界の具体物（人・物・授業など）を識別するための名前です。",
  slotKey:
    "【スロット名（属性名）】オブジェクトが持つ情報の名前です．",
  slotValue:
    "【スロット値】属性の具体的な値です。数値はそのまま、文字は \"...\" として扱われます。",
  linkEndpoints:
    "【リンク（関係）】オブジェクト同士の関係です。ここで「どのオブジェクトとどのオブジェクトが関係を持つか」を指定します。",
  linkLabel:
    "【リンクラベル】関係の意味を短い言葉で表します．行為や関係を表す表現が使われることが多いです．",
} as const;

// ===== 折りたたみヘッダ =====
const AssistHeader: React.FC<{
  title: string;
  enabled: boolean;
  collapsed: boolean;
  onToggle: () => void;
  rightText?: string;
}> = ({ title, enabled, collapsed, onToggle, rightText }) => {
  return (
    <div className="sticky top-0 z-10 bg-slate-50 p-2 border-b">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[12px]">{title}</span>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white hover:bg-slate-100"
            onClick={onToggle}
            disabled={!enabled}
            title={collapsed ? "アシストを開く" : "アシストを閉じる"}
          >
            {collapsed ? "表示する" : "折りたたむ"}
          </button>
        </div>

        {!enabled ? (
          <span className="text-[11px] text-slate-500">
            正答例（オブジェクト図）が未設定のため利用できません
          </span>
        ) : rightText ? (
          <span className="text-[11px] text-slate-600">{rightText}</span>
        ) : null}
      </div>

      {enabled && collapsed && (
        <div className="mt-1 text-[11px] text-slate-500">
          ※ ヒントを使うには「表示する」で展開してください
        </div>
      )}
    </div>
  );
};

// ===== メイン =====
const ExperimentPage: React.FC = () => {
  const router = useRouter();
  const { classProblemText, objectProblemText, objectAnswerPuml } =
    useProblemConfig();

  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

  const [encodedObjectPuml, setEncodedObjectPuml] = useState<string>("");
  const [classPuml, setClassPuml] = useState<string>("");
  const [encodedClassPuml, setEncodedClassPuml] = useState<string>("");
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);

  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3.0;
  const ZOOM_STEP = 0.1;

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  const [objectZoom, setObjectZoom] = useState(1);
  const [classZoom, setClassZoom] = useState(1);

  const [showClassProblemFull, setShowClassProblemFull] = useState(false);
  const [showObjectProblemFull, setShowObjectProblemFull] = useState(false);

  const [objChecked, setObjChecked] = useState(false);
  const [objDiagnoseSnapshot, setObjDiagnoseSnapshot] =
    useState<ObjDiagnoseSnapshot | null>(null);
  const [objRevealExtra, setObjRevealExtra] = useState(0);
  const [objDirtySinceHint, setObjDirtySinceHint] = useState(false);

  const [linkChecked, setLinkChecked] = useState(false);
  const [linkDiagnoseSnapshot, setLinkDiagnoseSnapshot] =
    useState<LinkDiagnoseSnapshot | null>(null);
  const [linkRevealExtra, setLinkRevealExtra] = useState(0);
  const [linkDirtySinceHint, setLinkDirtySinceHint] = useState(false);

  const [objRevealUnlockedNotice, setObjRevealUnlockedNotice] = useState(false);
  const [linkRevealUnlockedNotice, setLinkRevealUnlockedNotice] =
    useState(false);

  const prevObjRevealCanProceedRef = useRef(false);
  const prevLinkRevealCanProceedRef = useRef(false);

  const [objAssistCollapsed, setObjAssistCollapsed] = useState(false);
  const [linkAssistCollapsed, setLinkAssistCollapsed] = useState(false);

  const markMeaningfulChange = (affectObj: boolean, affectLink: boolean) => {
    if (affectObj) setObjDirtySinceHint(true);
    if (affectLink) setLinkDirtySinceHint(true);
  };

  const objAssistScrollRef = useRef<HTMLDivElement | null>(null);
  const linkAssistScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollObjAssistToBottom = () => {
    setTimeout(() => {
      const el = objAssistScrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 0);
  };
  const scrollLinkAssistToBottom = () => {
    setTimeout(() => {
      const el = linkAssistScrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 0);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      if (parsed.objects) setObjects(parsed.objects);
      if (parsed.links) setLinks(parsed.links);
    } catch {
      // ignore
    }
  }, []);

  const hasUnnamedObject = useMemo(() => {
    return objects.some((o) => !o.name || o.name.trim().length === 0);
  }, [objects]);

  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
      setEncodedObjectPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");

    for (const o of objects) {
      const safeName = o.name || "(無名)";
      const underlined = `<u>${escLabel(safeName)}</u>`;
      lines.push(`object "${underlined}" as ${o.id} {`);

      for (const s of o.slots) {
        if (!s.key && !s.value) continue;
        const val = formatSlotValue(s.value);
        const display = val ? `${s.key} = ${val}` : s.key;
        lines.push(`  ${display}`);
      }
      lines.push("}");
    }

    for (const l of links) {
      const from = objects.find((o) => o.id === l.from);
      const to = objects.find((o) => o.id === l.to);
      if (!from || !to) continue;

      const labelPart = l.label ? ` : ${escLabel(l.label)}` : "";
      lines.push(`${from.id} -- ${to.id}${labelPart}`);
    }

    lines.push("@enduml");
    const puml = lines.join("\n");

    try {
      setEncodedObjectPuml(plantumlEncoder.encode(puml));
    } catch {
      setEncodedObjectPuml("");
    }
  }, [objects, links]);

  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
      setClassPuml("");
      setEncodedClassPuml("");
      setIssues(null);
      setRelationHints([]);
      return;
    }

    if (hasUnnamedObject) {
      setClassPuml("");
      setEncodedClassPuml("");
      setIssues(null);
      setRelationHints([]);
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
            links: links.map((l) => {
              const fromObj = objects.find((o) => o.id === l.from);
              const toObj = objects.find((o) => o.id === l.to);
              return {
                from: fromObj?.name ?? "",
                to: toObj?.name ?? "",
                label: l.label,
              };
            }),
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
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        console.error(e);
      }
    }, 500);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [objects, links, hasUnnamedObject]);

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
      const labels = extractObjectLabelsFromPuml(objectAnswerPuml);
      for (const raw of labels) {
        const base = baseNameForAssist(raw);
        if (base) requiredBases.add(base);
      }
    }

    const presentBases = new Set<string>();
    for (const o of objects) {
      if (editingObjectId && o.id === editingObjectId) continue;
      if (!o.name || o.name.trim().length === 0) continue;

      const base = baseNameForAssist(o.name);
      if (!base) continue;
      presentBases.add(base);
    }

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
    for (const o of objects) {
      if (editingObjectId && o.id === editingObjectId) continue;
      if (!o.name || o.name.trim().length === 0) continue;

      const base = baseNameForAssist(o.name);
      if (!base) continue;

      const set = presentSlotKeysByBase.get(base) ?? new Set<string>();
      for (const s of o.slots) {
        const k = normalizeSlotKey(s.key);
        if (!k) continue;
        set.add(k);
      }
      presentSlotKeysByBase.set(base, set);
    }

    let requiredSlotKeyTotal = 0;
    let missingSlotKeyTotal = 0;

    for (const [base, reqSet] of requiredSlotKeysByBase.entries()) {
      if (!requiredBases.has(base)) continue;
      if (!presentBases.has(base)) continue;
      if (!reqSet || reqSet.size === 0) continue;
      requiredSlotKeyTotal += reqSet.size;

      const presentSet = presentSlotKeysByBase.get(base) ?? new Set<string>();
      for (const k of reqSet) {
        if (!presentSet.has(k)) missingSlotKeyTotal += 1;
      }
    }

    const matchedSlotKeyTotal = Math.max(
      0,
      requiredSlotKeyTotal - missingSlotKeyTotal
    );

    let extraSlotKeyTotal = 0;
    for (const [base, presentSet] of presentSlotKeysByBase.entries()) {
      if (!requiredBases.has(base)) continue;
      if (!presentBases.has(base)) continue;
      const reqSet = requiredSlotKeysByBase.get(base) ?? new Set<string>();
      for (const k of presentSet) {
        if (!reqSet.has(k)) extraSlotKeyTotal += 1;
      }
    }

    return {
      enabled,
      requiredBases,
      presentBases,
      missingBases,
      extraBases,

      requiredSlotKeysByBase,
      presentSlotKeysByBase,
      requiredSlotKeyTotal,
      missingSlotKeyTotal,
      matchedSlotKeyTotal,
      extraSlotKeyTotal,
    };
  }, [objects, objectAnswerPuml, editingObjectId]);

  const objSnapshot = objChecked ? objDiagnoseSnapshot : null;

  const objRequiredCount = objSnapshot
    ? objSnapshot.requiredCount
    : objAssist.requiredBases.size;
  const objMissingCount = objSnapshot
    ? objSnapshot.missingCount
    : objAssist.missingBases.length;
  const objMatchedCount = Math.max(0, objRequiredCount - objMissingCount);
  const objExtraCount = objSnapshot
    ? objSnapshot.extraCount
    : objAssist.extraBases.length;

  const objSlotRequiredTotal = objSnapshot
    ? objSnapshot.slotRequiredTotal
    : objAssist.requiredSlotKeyTotal;
  const objSlotMissingTotal = objSnapshot
    ? objSnapshot.slotMissingTotal
    : objAssist.missingSlotKeyTotal;
  const objSlotMatchedTotal = objSnapshot
    ? objSnapshot.slotMatchedTotal
    : objAssist.matchedSlotKeyTotal;
  const objExtraSlotCount = objSnapshot
    ? objSnapshot.extraSlotCount
    : objAssist.extraSlotKeyTotal;

  const objExtraBasesForReveal = objSnapshot
    ? objSnapshot.extraBases
    : objAssist.extraBases;

  const objInputTotal = objSnapshot
    ? objSnapshot.inputTotal
    : objects.filter(
        (o) =>
          !!(o.name && o.name.trim().length > 0) &&
          !(editingObjectId && o.id === editingObjectId)
      ).length;
  const objInputMatched = objSnapshot
    ? objSnapshot.inputMatched
    : objects.filter((o) => {
        if (editingObjectId && o.id === editingObjectId) return false;
        if (!o.name || o.name.trim().length === 0) return false;
        const base = baseNameForAssist(o.name);
        return !!base && objAssist.requiredBases.has(base);
      }).length;
  const objInputUnmatched = objSnapshot
    ? objSnapshot.inputUnmatched
    : Math.max(0, objInputTotal - objInputMatched);

  const objHasExtraNow = objAssist.enabled && objExtraCount > 0;
  const objShowExtraError = objChecked && objHasExtraNow;

  const objRevealDisabledReason = useMemo(() => {
    if (!objChecked) return "まず「オブジェクトを診断する」を押してください。";
    if (objExtraBasesForReveal.length === 0)
      return "正答例と異なる候補がないため表示できません。";
    if (objRevealExtra >= objExtraBasesForReveal.length)
      return "候補はすべて表示済みです。";
    if (!objDirtySinceHint)
      return "次の候補を見るには、診断後にオブジェクト図を一度修正してください。";
    return null;
  }, [objChecked, objExtraBasesForReveal.length, objRevealExtra, objDirtySinceHint]);

  const objRevealDisabled = objRevealDisabledReason !== null;

  const objRevealCanProceed =
    objChecked &&
    objExtraBasesForReveal.length > 0 &&
    objRevealExtra < objExtraBasesForReveal.length &&
    objDirtySinceHint;

  useEffect(() => {
    const prev = prevObjRevealCanProceedRef.current;
    prevObjRevealCanProceedRef.current = objRevealCanProceed;
    if (!prev && objRevealCanProceed) {
      setObjRevealUnlockedNotice(true);
      const t = window.setTimeout(() => setObjRevealUnlockedNotice(false), 2500);
      return () => window.clearTimeout(t);
    }
  }, [objRevealCanProceed]);

  const linkAssist = useMemo(() => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);

    const requiredLinks = enabled ? extractLinksFromPuml(objectAnswerPuml) : [];
    const requiredEndpointKeys = new Set<string>(
      requiredLinks.map((r) => r.endpointKey)
    );

    const requiredLabelsByEndpoint = new Map<string, Set<string>>();
    for (const r of requiredLinks) {
      if (!r.label) continue;
      const s = requiredLabelsByEndpoint.get(r.endpointKey) ?? new Set<string>();
      s.add(r.label);
      requiredLabelsByEndpoint.set(r.endpointKey, s);
    }

    const presentLinks: LinkSig[] = [];
    for (const l of links) {
      const fromObj = objects.find((o) => o.id === l.from);
      const toObj = objects.find((o) => o.id === l.to);
      if (!fromObj || !toObj) continue;
      if (!fromObj.name || !toObj.name) continue;

      const aBase = baseNameForAssist(fromObj.name);
      const bBase = baseNameForAssist(toObj.name);
      if (!aBase || !bBase) continue;

      const label = normalizeLinkLabel(l.label ?? "");
      const endpointKey = makeEndpointKey(aBase, bBase);
      const fullKey = makeFullKey(endpointKey, label);
      const pretty = label
        ? `${aBase} — ${bBase}（${label}）`
        : `${aBase} — ${bBase}`;
      presentLinks.push({
        a: aBase,
        b: bBase,
        label,
        endpointKey,
        fullKey,
        pretty,
      });
    }

    const presentEndpointKeys = new Set<string>(
      presentLinks.map((p) => p.endpointKey)
    );

    const missingEndpoints = enabled
      ? Array.from(requiredEndpointKeys)
          .filter((k) => !presentEndpointKeys.has(k))
          .sort((a, b) => a.localeCompare(b, "ja"))
      : [];

    const extraLinks = enabled
      ? presentLinks
          .filter((p) => !requiredEndpointKeys.has(p.endpointKey))
          .sort((x, y) => x.pretty.localeCompare(y.pretty, "ja"))
      : [];

    const missingPretty = missingEndpoints.map((k) => {
      const [x, y] = k.split("||");
      return `${x} — ${y}`;
    });

    const labelWarnings: { pretty: string; expected: string[]; actual: string }[] = [];
    for (const p of presentLinks) {
      const expectedSet = requiredLabelsByEndpoint.get(p.endpointKey);
      if (!expectedSet || expectedSet.size === 0) continue;
      const expected = Array.from(expectedSet);
      if (!expected.includes(p.label)) {
        const [x, y] = p.endpointKey.split("||");
        labelWarnings.push({
          pretty: `${x} — ${y}`,
          expected,
          actual: p.label || "(未入力)",
        });
      }
    }

    return {
      enabled,
      requiredEndpointKeys,
      presentEndpointKeys,
      missingPretty,
      extraLinks,
      labelWarnings,
    };
  }, [objectAnswerPuml, objects, links]);

  const linkRequiredCount = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.requiredCount
    : linkAssist.requiredEndpointKeys.size;
  const linkMissingCount = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.missingCount
    : linkAssist.missingPretty.length;
  const linkMatchedCount = Math.max(0, linkRequiredCount - linkMissingCount);
  const linkExtraLinksForReveal = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.extraLinks
    : linkAssist.extraLinks;
  const linkExtraCount = linkExtraLinksForReveal.length;
  const linkLabelWarningsForDisplay = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.labelWarnings
    : linkAssist.labelWarnings;

  const linkInputTotal = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.inputTotal
    : (() => {
        let cnt = 0;
        for (const l of links) {
          const fromObj = objects.find((o) => o.id === l.from);
          const toObj = objects.find((o) => o.id === l.to);
          if (!fromObj || !toObj) continue;
          if (!fromObj.name?.trim() || !toObj.name?.trim()) continue;
          cnt += 1;
        }
        return cnt;
      })();
  const linkInputMatched = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.inputMatched
    : (() => {
        let matched = 0;
        for (const l of links) {
          const fromObj = objects.find((o) => o.id === l.from);
          const toObj = objects.find((o) => o.id === l.to);
          if (!fromObj || !toObj) continue;
          if (!fromObj.name?.trim() || !toObj.name?.trim()) continue;

          const fromBase = baseNameForAssist(fromObj.name);
          const toBase = baseNameForAssist(toObj.name);
          if (!fromBase || !toBase) continue;

          const endpointKey = makeEndpointKey(fromBase, toBase);
          if (linkAssist.requiredEndpointKeys.has(endpointKey)) matched += 1;
        }
        return matched;
      })();
  const linkInputUnmatched = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.inputUnmatched
    : Math.max(0, linkInputTotal - linkInputMatched);

  const linkHasExtraNow = linkAssist.enabled && linkExtraCount > 0;
  const linkShowExtraError = linkChecked && linkHasExtraNow;

  const linkRevealDisabledReason = useMemo(() => {
    if (!linkChecked) return "まず「リンクを診断する」を押してください。";
    if (linkExtraLinksForReveal.length === 0)
      return "正答例と異なる候補がないため表示できません。";
    if (linkRevealExtra >= linkExtraLinksForReveal.length)
      return "候補はすべて表示済みです。";
    if (!linkDirtySinceHint)
      return "次の候補を見るには、診断後にリンク（端点/ラベル）を一度修正してください。";
    return null;
  }, [
    linkChecked,
    linkExtraLinksForReveal.length,
    linkRevealExtra,
    linkDirtySinceHint,
  ]);

  const linkRevealDisabled = linkRevealDisabledReason !== null;

  const linkRevealCanProceed =
    linkChecked &&
    linkExtraLinksForReveal.length > 0 &&
    linkRevealExtra < linkExtraLinksForReveal.length &&
    linkDirtySinceHint;

  useEffect(() => {
    const prev = prevLinkRevealCanProceedRef.current;
    prevLinkRevealCanProceedRef.current = linkRevealCanProceed;
    if (!prev && linkRevealCanProceed) {
      setLinkRevealUnlockedNotice(true);
      const t = window.setTimeout(() => setLinkRevealUnlockedNotice(false), 2500);
      return () => window.clearTimeout(t);
    }
  }, [linkRevealCanProceed]);

  // ===== オブジェクト操作 =====
  const handleAddObject = () => {
    const id = makeId();
    const newObj: Obj = { id, name: "", slots: [] };
    setObjects((prev) => [...prev, newObj]);
    setSelectedObjectId(id);
    setSelectedLinkId(null);
    markMeaningfulChange(true, true);
  };

  const handleUpdateObjectName = (id: string, newName: string) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, name: newName } : o))
    );
    markMeaningfulChange(true, true);
  };

  const handleDeleteObject = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setLinks((prev) => prev.filter((l) => l.from !== id && l.to !== id));
    if (selectedObjectId === id) setSelectedObjectId(null);
    if (editingObjectId === id) setEditingObjectId(null);
    markMeaningfulChange(true, true);
  };

  // ===== スロット操作 =====
  const handleAddSlotToSelected = () => {
    if (!selectedObject) return;
    const updated: Obj = {
      ...selectedObject,
      slots: [...selectedObject.slots, { key: "", value: "" }],
    };
    setObjects((prev) =>
      prev.map((o) => (o.id === selectedObject.id ? updated : o))
    );
    markMeaningfulChange(true, false);
  };

  const handleUpdateSlot = (index: number, partial: Partial<Slot>) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.map((s, i) =>
      i === index ? { ...s, ...partial } : s
    );
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selectedObject.id ? { ...o, slots: newSlots } : o
      )
    );
    markMeaningfulChange(true, false);
  };

  const handleDeleteSlot = (index: number) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.filter((_, i) => i !== index);
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selectedObject.id ? { ...o, slots: newSlots } : o
      )
    );
    markMeaningfulChange(true, false);
  };

  // ===== リンク操作 =====
  const handleAddLink = () => {
    if (objects.length < 2) return;
    const id = makeId();
    const newLink: Link = {
      id,
      from: objects[0]?.id ?? "",
      to: objects[1]?.id ?? "",
      label: "",
    };
    setLinks((prev) => [...prev, newLink]);
    setSelectedLinkId(id);
    setSelectedObjectId(null);
    markMeaningfulChange(false, true);
  };

  const handleUpdateLink = (id: string, partial: Partial<Link>) => {
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...partial } : l))
    );
    markMeaningfulChange(false, true);
  };

  const handleDeleteLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    if (selectedLinkId === id) setSelectedLinkId(null);
    markMeaningfulChange(false, true);
  };

  // ===== 状態の保存・復元・クリア =====
  const handleSaveState = () => {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    alert("現在のオブジェクト図の状態を保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return alert("保存されている状態がありません。");
      const parsed = JSON.parse(raw) as { objects?: Obj[]; links?: Link[] };
      setObjects(parsed.objects ?? []);
      setLinks(parsed.links ?? []);
      setSelectedObjectId(null);
      setSelectedLinkId(null);
      setEditingObjectId(null);

      setObjChecked(false);
      setObjDiagnoseSnapshot(null);
      setObjRevealExtra(0);
      setObjDirtySinceHint(false);
      setLinkChecked(false);
      setLinkDiagnoseSnapshot(null);
      setLinkRevealExtra(0);
      setLinkDirtySinceHint(false);

      markMeaningfulChange(true, true);
      alert("保存されていた状態を復元しました。");
    } catch {
      alert("状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleClearAll = () => {
    if (!window.confirm("オブジェクトとリンクをすべて削除します。よろしいですか？"))
      return;
    setObjects([]);
    setLinks([]);
    setSelectedObjectId(null);
    setSelectedLinkId(null);
    setEditingObjectId(null);

    setObjChecked(false);
    setObjDiagnoseSnapshot(null);
    setObjRevealExtra(0);
    setObjDirtySinceHint(false);
    setLinkChecked(false);
    setLinkDiagnoseSnapshot(null);
    setLinkRevealExtra(0);
    setLinkDirtySinceHint(false);

    setClassPuml("");
    setEncodedClassPuml("");
    setIssues(null);
    setRelationHints([]);
    markMeaningfulChange(true, true);
  };

  const handleConvertAndOpenClassEditor = async () => {
    if (hasUnnamedObject) {
      alert(
        "インスタンス名が未入力のものがあります。\nすべてのオブジェクトに名前を入力してください。"
      );
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    } catch {
      // ignore
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
            links: links.map((l) => {
              const fromObj = objects.find((o) => o.id === l.from);
              const toObj = objects.find((o) => o.id === l.to);
              return {
                from: fromObj?.name ?? "",
                to: toObj?.name ?? "",
                label: l.label,
              };
            }),
          }),
        });

        if (!res.ok) {
          console.error("convert API error", await res.text());
          alert("クラス図への変換中にエラーが発生しました。");
          return;
        }

        const data = (await res.json()) as ConvertResponse;

        const solid = forceSolidRelations(data.classPuml);
        let encoded = "";
        try {
          encoded = plantumlEncoder.encode(solid);
        } catch {
          encoded = data.encodedPuml;
        }

        setClassPuml(solid);
        setEncodedClassPuml(encoded);
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);
        result = { ...data, classPuml: solid, encodedPuml: encoded };
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
      snapshot: { objects, links },
    };
    try {
      localStorage.setItem(STORAGE_KEY_EDITOR_INITIAL, JSON.stringify(editorPayload));
    } catch {
      // ignore
    }

    router.push("/experiment2/class-editor");
  };

  const displayClassPuml = useMemo(() => {
    return sanitizeClassPumlForLearner(forceSolidRelations(classPuml));
  }, [classPuml]);

  const displayEncodedClassPuml = useMemo(() => {
    if (!displayClassPuml) return "";
    try {
      return plantumlEncoder.encode(displayClassPuml);
    } catch {
      return "";
    }
  }, [displayClassPuml]);

  const objectPreviewUrl = useMemo(() => {
    if (!encodedObjectPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}`;
  }, [encodedObjectPuml]);

  const classPreviewUrl = useMemo(() => {
    if (!displayEncodedClassPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${displayEncodedClassPuml}`;
  }, [displayEncodedClassPuml]);

  const proceedDisabled = hasUnnamedObject;

  const proceedDisabledReason = useMemo(() => {
    if (!proceedDisabled) return "";
    return "インスタンス名が未入力のものがあります。";
  }, [proceedDisabled]);

  const proceedHoverMessage = useMemo(() => {
    if (!proceedDisabled) return "";
    return `理由：${proceedDisabledReason}`;
  }, [proceedDisabled, proceedDisabledReason]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 上部ボタン列 */}
      <div className="flex items-center gap-2 p-2 border-b bg-white">
        <button
          className="px-3 py-1 rounded bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200"
          onClick={handleClearAll}
        >
          すべてクリア
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
          最後の保存状態を復元
        </button>

        <div className="flex-1" />

        <div className={"relative group " + (proceedDisabled ? "cursor-not-allowed" : "")}>
          <button
            className={
              "px-4 py-1.5 rounded text-sm font-semibold " +
              (proceedDisabled
                ? "bg-slate-300 text-slate-600 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700")
            }
            onClick={handleConvertAndOpenClassEditor}
            disabled={proceedDisabled}
          >
            クラス図編集画面へ進む
          </button>

          {proceedDisabled && (
            <div className="pointer-events-none absolute right-0 top-full mt-2 hidden group-hover:block">
              <div className="max-w-[340px] whitespace-pre-wrap text-[11px] leading-relaxed bg-slate-900 text-white rounded px-3 py-2 shadow">
                {proceedHoverMessage}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* メイン 3カラムレイアウト */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：問題文 */}
        <div className="w-1/4 min-w-[260px] border-r bg-white flex flex-col overflow-y-auto">
          <div className="p-2 text-xs flex flex-col gap-1 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold">オブジェクト図作成問題文</span>
              <button
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-slate-100"
                onClick={() => setShowObjectProblemFull((v) => !v)}
              >
                {showObjectProblemFull ? "本文を折りたたむ" : "本文を表示"}
              </button>
            </div>
            <div
              className={
                "mt-1 whitespace-pre-wrap text-[11px] leading-relaxed border rounded bg-slate-50 px-2 py-1 " +
                (showObjectProblemFull ? "" : "max-h-[80px] overflow-hidden")
              }
            >
              {objectProblemText}
            </div>
          </div>
        </div>

        {/* 中央：オブジェクト編集＋オブジェクト図プレビュー */}
        <div className="w-1/3 border-r flex flex-col">
          {/* オブジェクト編集 */}
          <div className="h-1/2 border-b flex flex-col min-h-0">
            <div className="p-2 border-b flex items-center justify-between bg-white">
              <span className="font-semibold text-sm">オブジェクト編集</span>
              <button
                className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                onClick={handleAddObject}
              >
                ＋ オブジェクト追加
              </button>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* オブジェクト一覧 */}
              <div className="w-2/5 border-r overflow-y-auto text-xs bg-slate-50">
                {objects.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだオブジェクトがありません。「オブジェクト追加」から作成してください。
                  </div>
                )}
                {objects.map((o) => {
                  return (
                    <button
                      key={o.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex items-center justify-between hover:bg-slate-100"
                      }
                      onClick={() => {
                        setSelectedObjectId((prev) => (prev === o.id ? null : o.id));
                        setSelectedLinkId(null);
                      }}
                    >
                      <span className="truncate">{o.name || "(無名オブジェクト)"}</span>
                      <span className="text-[10px] text-slate-500 ml-2">{o.slots.length} スロット</span>
                    </button>
                  );
                })}
              </div>

              {/* オブジェクト詳細編集 */}
              <div className="flex-1 overflow-y-auto text-xs p-2">
                {!selectedObject && (
                  <div className="text-[11px] text-slate-500">
                    左の一覧から編集したいオブジェクトを選択してください。
                  </div>
                )}
                {selectedObject && (
                  <div className="flex flex-col gap-2">
                    <div>
                      <div className="flex items-center">
                        <label className="block text-[11px] font-semibold mb-1" title={TOOLTIP.objectName}>
                          インスタンス名
                        </label>
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-xs"
                        value={selectedObject.name}
                        onChange={(e) => handleUpdateObjectName(selectedObject.id, e.target.value)}
                        onFocus={() => setEditingObjectId(selectedObject.id)}
                        onBlur={() => setEditingObjectId(null)}
                        placeholder=""
                        title={TOOLTIP.objectName}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center">
                          <span className="text-[11px] font-semibold" title={`${TOOLTIP.slotKey}\n${TOOLTIP.slotValue}`}>
                            スロット（スロット名 と 値）
                          </span>
                        </div>

                        <button
                          className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                          onClick={handleAddSlotToSelected}
                        >
                          ＋ スロット追加
                        </button>
                      </div>

                      {selectedObject.slots.length === 0 && (
                        <div className="text-[11px] text-slate-500 mb-1"></div>
                      )}

                      <div className="flex flex-col gap-1">
                        {selectedObject.slots.map((s, idx) => (
                          <div key={idx} className="border rounded px-2 py-1 bg-white flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.key}
                                onChange={(e) => handleUpdateSlot(idx, { key: e.target.value })}
                                placeholder=""
                                title={TOOLTIP.slotKey}
                              />
                              <span className="text-[11px] text-slate-400">=</span>
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.value}
                                onChange={(e) => handleUpdateSlot(idx, { value: e.target.value })}
                                placeholder={""}
                                title={TOOLTIP.slotValue}
                              />
                            </div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => handleDeleteSlot(idx)}
                              >
                                🗑 スロット削除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-dashed border-red-200 flex justify-end">
                      <button
                        type="button"
                        className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 font-semibold hover:bg-red-200"
                        onClick={() => handleDeleteObject(selectedObject.id)}
                      >
                        🗑 このオブジェクトを削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* オブジェクト図プレビュー */}
          <div className="flex-1 flex flex-col">
            <div className="p-2 border-b bg-white flex items-center justify-between">
              <span className="font-semibold text-sm">オブジェクト図プレビュー</span>

              <div className="flex items-center gap-2">
                <span className="text-[11px] w-12 text-center tabular-nums">
                  {Math.round(objectZoom * 100)}%
                </span>

                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={ZOOM_STEP}
                  value={objectZoom}
                  onChange={(e) => setObjectZoom(clampZoom(parseFloat(e.currentTarget.value)))}
                  disabled={!objectPreviewUrl}
                  className="w-40"
                  title="ドラッグして倍率を変更"
                  aria-label="オブジェクト図の倍率"
                />

                <button
                  type="button"
                  className="px-2 py-0.5 text-[11px] border rounded bg-white hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => setObjectZoom(1)}
                  disabled={!objectPreviewUrl}
                  title="等倍（100%）"
                >
                  100%
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-white p-2">
              {objectPreviewUrl && (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div style={{ zoom: objectZoom }} className="inline-block origin-top-left">
                    <img src={objectPreviewUrl} alt="オブジェクト図プレビュー" className="block max-w-none h-auto" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右：リンク編集＋推定クラス図プレビュー */}
        <div className="flex-1 flex flex-col">
          {/* リンク編集 */}
          <div className="h-1/2 border-b flex flex-col min-h-0">
            <div className="p-2 border-b flex items-center justify-between bg-white">
              <span className="font-semibold text-sm">リンク編集</span>
              <button
                className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                onClick={handleAddLink}
              >
                ＋ リンク追加
              </button>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden text-xs">
              {/* リンク一覧 */}
              <div className="w-1/2 border-r overflow-y-auto bg-slate-50">
                {links.length === 0 && (
                  <div className="p-2 text-[11px] text-slate-500">
                    まだリンクがありません。「リンク追加」から関係を追加してください。
                  </div>
                )}
                {links.map((l) => {
                  const from = objects.find((o) => o.id === l.from);
                  const to = objects.find((o) => o.id === l.to);

                  return (
                    <button
                      key={l.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex flex-col hover:bg-slate-100"
                      }
                      onClick={() => {
                        setSelectedLinkId((prev) => (prev === l.id ? null : l.id));
                        setSelectedObjectId(null);
                      }}
                    >
                      <div className="flex justify-between">
                        <span className="truncate">
                          {from?.name || "(未設定)"} → {to?.name || "(未設定)"}
                        </span>
                      </div>
                      {l.label && <div className="text-[10px] text-slate-500">{l.label}</div>}
                    </button>
                  );
                })}
              </div>

              {/* リンク詳細編集 */}
              <div className="flex-1 overflow-y-auto p-2">
                {!selectedLink && (
                  <div className="text-[11px] text-slate-500">
                    左の一覧から編集したいリンクを選択してください。
                  </div>
                )}
                {selectedLink && (
                  <div className="flex flex-col gap-2 text-xs">
                    <div>
                      <div className="flex items-center">
                        <label className="block text-[11px] font-semibold mb-1" title={TOOLTIP.linkEndpoints}>
                          リンク
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={selectedLink.from}
                          onChange={(e) => handleUpdateLink(selectedLink.id, { from: e.target.value })}
                          title={TOOLTIP.linkEndpoints}
                        >
                          {objects.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name || "(無名)"}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px]">→</span>
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={selectedLink.to}
                          onChange={(e) => handleUpdateLink(selectedLink.id, { to: e.target.value })}
                          title={TOOLTIP.linkEndpoints}
                        >
                          {objects.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name || "(無名)"}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center">
                        <label className="block text-[11px] font-semibold mb-1" title={TOOLTIP.linkLabel}>
                          リンクラベル
                        </label>
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-[11px]"
                        value={selectedLink.label}
                        onChange={(e) => handleUpdateLink(selectedLink.id, { label: e.target.value })}
                        placeholder=""
                        title={TOOLTIP.linkLabel}
                      />
                    </div>

                    <div className="mt-3 pt-2 border-t border-dashed border-red-200 flex justify-end">
                      <button
                        className="px-3 py-1 text-[11px] rounded bg-red-100 text-red-700 hover:bg-red-200 font-semibold"
                        onClick={() => handleDeleteLink(selectedLink.id)}
                      >
                        🗑 このリンクを削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 推定クラス図プレビュー */}
          <div className="flex-1 flex flex-col">
            <div className="p-2 border-b bg-white flex items-center justify-between">
              <span className="font-semibold text-sm">推定クラス図プレビュー</span>

              <div className="flex items-center gap-2">
                <div className="flex items-center mr-2">
                  <span className="text-[11px] text-slate-500" title={TYPE_LEGEND_TOOLTIP}>
                    型の見方
                  </span>
                </div>

                <span className="text-[11px] w-12 text-center tabular-nums">
                  {Math.round(classZoom * 100)}%
                </span>

                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={ZOOM_STEP}
                  value={classZoom}
                  onChange={(e) => setClassZoom(clampZoom(parseFloat(e.currentTarget.value)))}
                  disabled={!classPreviewUrl}
                  className="w-40"
                  title="ドラッグして倍率を変更"
                  aria-label="推定クラス図の倍率"
                />

                <button
                  type="button"
                  className="px-2 py-0.5 text-[11px] border rounded bg-white hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => setClassZoom(1)}
                  disabled={!classPreviewUrl}
                  title="等倍（100%）"
                >
                  100%
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-white flex flex-col">
              {hasUnnamedObject && (
                <div className="p-3 text-[11px] text-slate-600">
                  推定クラス図は一時停止中です。<br />
                  <span className="font-semibold">インスタンス名が未入力</span>のものがあるため、
                  すべてのオブジェクトに名前を入力してください。
                </div>
              )}

              {!hasUnnamedObject && displayEncodedClassPuml && (
                <div className="flex-1 flex flex-col">
                  {classPreviewUrl && (
                    <div className="flex-1 overflow-auto border-b bg-white p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <div style={{ zoom: classZoom }} className="inline-block origin-top-left">
                        <img src={classPreviewUrl} alt="推定クラス図" className="block max-w-none h-auto" />
                      </div>
                    </div>
                  )}
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
