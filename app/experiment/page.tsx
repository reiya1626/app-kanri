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

// ===== OD作成アシスト（パターン1/4） =====
const stripHtmlTags = (s: string) => s.replace(/<[^>]*>/g, "");

const normalizeObjectLabel = (raw: string) => {
  const noTags = stripHtmlTags(raw).trim();
  const left = noTags.includes(":") ? noTags.split(":")[0].trim() : noTags;
  return left.replace(/^"+|"+$/g, "").trim();
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
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "");
  return t;
};

// 正答PlantUMLから object ラベル抽出（{があってもなくても拾う）
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

// 正答PUML内の object 行から alias -> baseName を作る
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

type LinkSig = {
  a: string; // base
  b: string; // base
  label: string; // normalized label
  endpointKey: string; // endpoints only
  fullKey: string; // endpoints + label (for warnings)
  pretty: string; // display
};

const makeEndpointKey = (aBase: string, bBase: string) => {
  const x = aBase <= bBase ? aBase : bBase;
  const y = aBase <= bBase ? bBase : aBase;
  return `${x}||${y}`;
};

const makeFullKey = (endpointKey: string, labelNorm: string) =>
  `${endpointKey}||${labelNorm}`;

// 正答PUMLからリンク抽出（aliasでも日本語でも拾える）
const extractLinksFromPuml = (puml: string) => {
  const out: LinkSig[] = [];
  if (!puml) return out;

  const aliasToBase = extractAliasToBaseFromPuml(puml);
  const lines = puml.split(/\r?\n/);

  // かなり広めに拾う（--, ->, .., o-- など）
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

  // 重複除去：同じ endpoints+label は1つにする
  const uniq = new Map<string, LinkSig>();
  for (const l of out) {
    if (!uniq.has(l.fullKey)) uniq.set(l.fullKey, l);
  }
  return Array.from(uniq.values());
};

// ===== 問題文ハイライト用ユーティリティ =====
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightTextWithTokens = (
  text: string,
  tokens: { text: string; kind: "object" | "link" }[]
): React.ReactNode => {
  const cleaned = tokens
    .map((t) => ({ ...t, text: t.text.trim() }))
    .filter((t) => t.text.length > 0);

  if (!text || cleaned.length === 0) return text;

  const uniqKey = new Map<string, { text: string; kind: "object" | "link" }>();
  for (const t of cleaned) {
    const key = `${t.kind}::${t.text}`;
    if (!uniqKey.has(key)) uniqKey.set(key, t);
  }
  const uniq = Array.from(uniqKey.values()).sort(
    (a, b) => b.text.length - a.text.length
  );

  const pattern = uniq.map((t) => escapeRegExp(t.text)).join("|");
  if (!pattern) return text;

  const re = new RegExp(`(${pattern})`, "g");
  const parts = text.split(re);

  const tokenMap = new Map<string, "object" | "link">();
  for (const t of uniq) tokenMap.set(t.text, t.kind);

  return (
    <>
      {parts.map((p, i) => {
        const kind = tokenMap.get(p);
        if (!kind) return <React.Fragment key={i}>{p}</React.Fragment>;

        const cls =
          kind === "object"
            ? "bg-amber-100 rounded px-0.5 font-semibold"
            : "bg-rose-100 rounded px-0.5 font-semibold";

        return (
          <span key={i} className={cls}>
            {p}
          </span>
        );
      })}
    </>
  );
};

const highlightProblemByLine = (
  fullText: string,
  tokens: { text: string; kind: "object" | "link" }[],
  linkFrom?: string,
  linkTo?: string
): React.ReactNode => {
  const lines = (fullText ?? "").split("\n");
  const from = (linkFrom ?? "").trim();
  const to = (linkTo ?? "").trim();

  return (
    <>
      {lines.map((line, idx) => {
        const hasBoth = from && to && line.includes(from) && line.includes(to);
        const lineNode = highlightTextWithTokens(line, tokens);

        return (
          <div
            key={idx}
            className={
              hasBoth
                ? "bg-rose-50 border border-rose-100 rounded px-1 py-0.5"
                : ""
            }
          >
            {lineNode}
          </div>
        );
      })}
    </>
  );
};

// ===== 用語説明（title用） =====
const TOOLTIP = {
  objectName:
    "【オブジェクト】現実世界の具体物（人・物・授業など）を表します。問題文に出てくる登場人物や対象をオブジェクトとして作成します。例：佐藤、文学",
  slotKey:
    "【スロット名（属性名）】オブジェクトが持つ情報の名前です。例：年齢、科目名",
  slotValue:
    "【スロット値】属性の具体的な値です。数値はそのまま、文字は \"...\" として扱われます（例：19、\"文学\"）。",
  linkEndpoints:
    "【リンク（関係）】オブジェクト同士の関係です。ここで「どのオブジェクトとどのオブジェクトが関係を持つか」を指定します。",
  linkLabel:
    "【リンクラベル】関係の意味を短い言葉で表します。例：履修する、担当する",
} as const;

// ===== ラベル用の ?（title表示の気づき誘導） =====
const HelpBadge: React.FC<{ title: string }> = ({ title }) => {
  return (
    <span
      title={title}
      className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 text-[10px] text-slate-600 bg-white cursor-help underline decoration-dotted"
      aria-label="用語の説明"
    >
      ?
    </span>
  );
};

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

  // --- オブジェクト／リンクの状態 ---
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // 「オブジェクト名入力中」のID（入力途中は過剰判定に含めない）
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

  // --- プレビュー（PlantUML） ---
  const [encodedObjectPuml, setEncodedObjectPuml] = useState<string>("");
  const [classPuml, setClassPuml] = useState<string>("");
  const [encodedClassPuml, setEncodedClassPuml] = useState<string>("");
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);

  // --- 問題文の表示制御 ---
  const [showClassProblemFull, setShowClassProblemFull] = useState(false);
  const [showObjectProblemFull, setShowObjectProblemFull] = useState(false);

  // ===== アシスト状態（オブジェクト） =====
  const [objChecked, setObjChecked] = useState(false); // ← 診断済みフラグとして使う
  const [objRevealExtra, setObjRevealExtra] = useState(0);
  const [objDirtySinceHint, setObjDirtySinceHint] = useState(false);

  // ===== アシスト状態（リンク） =====
  const [linkChecked, setLinkChecked] = useState(false); // ← 診断済みフラグとして使う
  const [linkRevealExtra, setLinkRevealExtra] = useState(0);
  const [linkDirtySinceHint, setLinkDirtySinceHint] = useState(false);

  // ===== アシスト折りたたみ =====
  const [objAssistCollapsed, setObjAssistCollapsed] = useState(false);
  const [linkAssistCollapsed, setLinkAssistCollapsed] = useState(false);

  const markMeaningfulChange = (affectObj: boolean, affectLink: boolean) => {
    if (affectObj) setObjDirtySinceHint(true);
    if (affectLink) setLinkDirtySinceHint(true);
  };

  // スクロール制御（ヒント追加時に下へ）
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

  // ===== ローカルストレージからの読み込み =====
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

  // ===== 無名オブジェクト判定（推定クラス図を止めるため） =====
  const hasUnnamedObject = useMemo(() => {
    return objects.some((o) => !o.name || o.name.trim().length === 0);
  }, [objects]);

  // ===== オブジェクト図 PlantUML の生成（リアルタイム） =====
  useEffect(() => {
    if (objects.length === 0 && links.length === 0) {
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

    const lines: string[] = [];
    lines.push("@startuml");

    for (const o of objects) {
      const safeName = o.name || "(無名)";
      const underlined = `<u>${escLabel(safeName)}</u>`;

      let fill = "";
      if (objectHighlightIds.has(o.id)) {
        fill = " #FFF6BF";
      } else if (linkHighlightIds.has(o.id)) {
        fill = " #FFD6E0";
      }

      lines.push(`object "${underlined}" as ${o.id}${fill} {`);
      for (const s of o.slots) {
        if (!s.key && !s.value) continue;
        const val = formatSlotValue(s.value);
        const display = val ? `${s.key}: ${val}` : s.key;
        lines.push(`  ${display}`);
      }
      lines.push("}");
    }

    for (const l of links) {
      const from = objects.find((o) => o.id === l.from);
      const to = objects.find((o) => o.id === l.to);
      if (!from || !to) continue;
      const labelPart = l.label ? ` : ${escLabel(l.label)}` : "";
      const isHighlighted = l.id === selectedLinkId;
      const linePattern = isHighlighted ? "-[#red]-" : "--";
      lines.push(`${from.id} ${linePattern} ${to.id}${labelPart}`);
    }

    lines.push("@enduml");
    const puml = lines.join("\n");

    try {
      setEncodedObjectPuml(plantumlEncoder.encode(puml));
    } catch {
      setEncodedObjectPuml("");
    }
  }, [objects, links, selectedObjectId, selectedLinkId]);

  // ===== 推定クラス図のリアルタイム更新 =====
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
        setClassPuml(data.classPuml);
        setEncodedClassPuml(data.encodedPuml);
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

  // ===== 選択オブジェクト/リンク =====
  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );

  const selectedLink = useMemo(
    () => links.find((l) => l.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  );

  // 選択リンクの from/to 名（問題文ハイライトに使う）
  const selectedLinkFromName = useMemo(() => {
    if (!selectedLink) return "";
    return objects.find((o) => o.id === selectedLink.from)?.name?.trim() ?? "";
  }, [selectedLink, objects]);

  const selectedLinkToName = useMemo(() => {
    if (!selectedLink) return "";
    return objects.find((o) => o.id === selectedLink.to)?.name?.trim() ?? "";
  }, [selectedLink, objects]);

  // ===== パターン1（オブジェクト不足/過剰） =====
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

    return { enabled, requiredBases, presentBases, missingBases, extraBases };
  }, [objects, objectAnswerPuml, editingObjectId]);

  const objRequiredCount = objAssist.requiredBases.size;
  const objMissingCount = objAssist.missingBases.length;
  const objMatchedCount = Math.max(0, objRequiredCount - objMissingCount);
  const objExtraCount = objAssist.extraBases.length;

  const objHasExtraNow = objAssist.enabled && objExtraCount > 0;
  const objShowExtraError = objChecked && objHasExtraNow;

  // ===== パターン4（リンク不足/過剰） =====
  // 方針②：不足/過剰は「端点だけ」で判定、ラベルは別の注意(warn)で扱う
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
      presentLinks.push({ a: aBase, b: bBase, label, endpointKey, fullKey, pretty });
    }

    const presentEndpointKeys = new Set<string>(presentLinks.map((p) => p.endpointKey));

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

  const linkRequiredCount = linkAssist.requiredEndpointKeys.size;
  const linkMissingCount = linkAssist.missingPretty.length;
  const linkMatchedCount = Math.max(0, linkRequiredCount - linkMissingCount);
  const linkExtraCount = linkAssist.extraLinks.length;

  const linkHasExtraNow = linkAssist.enabled && linkExtraCount > 0;
  const linkShowExtraError = linkChecked && linkHasExtraNow;

  // ===== オブジェクトアシスト操作 =====
  const handleObjDiagnose = () => setObjChecked(true);

  const handleObjRevealNextExtra = () => {
    if (!objChecked) return alert("まず「オブジェクトを診断する」を押してください。");
    if (objAssist.extraBases.length === 0) return;
    if (!objDirtySinceHint)
      return alert("次の表示を見る前に、オブジェクト図を一度修正してください。");
    if (objRevealExtra >= objAssist.extraBases.length) return;

    setObjAssistCollapsed(false);
    setObjRevealExtra((c) => c + 1);
    setObjDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // ===== リンクアシスト操作 =====
  const handleLinkDiagnose = () => setLinkChecked(true);

  const handleLinkRevealNextExtra = () => {
    if (!linkChecked) return alert("まず「リンクを診断する」を押してください。");
    if (linkAssist.extraLinks.length === 0) return;
    if (!linkDirtySinceHint)
      return alert("次の表示を見る前に、オブジェクト図を一度修正してください。");
    if (linkRevealExtra >= linkAssist.extraLinks.length) return;

    setLinkAssistCollapsed(false);
    setLinkRevealExtra((c) => c + 1);
    setLinkDirtySinceHint(false);
    scrollLinkAssistToBottom();
  };

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
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, name: newName } : o)));
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
    setObjects((prev) => prev.map((o) => (o.id === selectedObject.id ? updated : o)));
  };

  const handleUpdateSlot = (index: number, partial: Partial<Slot>) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.map((s, i) => (i === index ? { ...s, ...partial } : s));
    setObjects((prev) =>
      prev.map((o) => (o.id === selectedObject.id ? { ...o, slots: newSlots } : o))
    );
  };

  const handleDeleteSlot = (index: number) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.filter((_, i) => i !== index);
    setObjects((prev) =>
      prev.map((o) => (o.id === selectedObject.id ? { ...o, slots: newSlots } : o))
    );
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
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...partial } : l)));
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
      markMeaningfulChange(true, true);
      alert("保存されていた状態を復元しました。");
    } catch {
      alert("状態の読み込み中にエラーが発生しました。");
    }
  };

  const handleClearAll = () => {
    if (!window.confirm("オブジェクトとリンクをすべて削除します。よろしいですか？")) return;
    setObjects([]);
    setLinks([]);
    setSelectedObjectId(null);
    setSelectedLinkId(null);
    setEditingObjectId(null);
    setClassPuml("");
    setEncodedClassPuml("");
    setIssues(null);
    setRelationHints([]);
    markMeaningfulChange(true, true);
  };

  // ===== 進む前の警告（学習者向け最適化） =====
  // レベル感：
  // - 強：診断済みで「正答例と異なる候補」が残っている（過剰候補）
  // - 中：診断済みで「未カバー」が残っている（具体名は出さない）
  // - 弱：未診断のまま（まず診断を促す）
  const buildProceedWarningMessage = () => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);

    // 正答例が無いなら警告は出さない（このツールの学習設計上はOK）
    if (!enabled) return { needsConfirm: false, message: "" };

    const parts: string[] = [];
    let strong = false;
    let medium = false;
    let weak = false;

    // --- オブジェクト ---
    if (!objChecked) {
      if (objMissingCount > 0 || objExtraCount > 0) weak = true;
    } else {
      if (objExtraCount > 0) strong = true;
      if (objMissingCount > 0) medium = true;
    }

    // --- リンク ---
    if (!linkChecked) {
      if (linkMissingCount > 0 || linkExtraCount > 0) weak = true;
    } else {
      if (linkExtraCount > 0) strong = true;
      if (linkMissingCount > 0) medium = true;
    }

    // 何もなければ警告なし
    if (!strong && !medium && !weak) return { needsConfirm: false, message: "" };

    // タイトル（強いもの優先）
    const title = strong
      ? "【要確認】このまま進むと、クラス化（抽象化）が崩れる可能性があります。"
      : medium
      ? "【注意】このまま進むと、クラス図に必要な情報が不足する可能性があります。"
      : "【確認】進む前に、いちど診断して確認することをおすすめします。";

    parts.push(title);
    parts.push("");

    // 状態（数だけ、具体名は出さない）
    parts.push("■ 現在の状態（数のみ）");
    parts.push(
      `・オブジェクト：カバー ${objMatchedCount}/${objRequiredCount} ／ 未カバー ${objMissingCount}/${objRequiredCount} ／ 正答例と異なる候補 ${objExtraCount}`
    );
    parts.push(
      `・リンク：カバー ${linkMatchedCount}/${linkRequiredCount} ／ 未カバー ${linkMissingCount}/${linkRequiredCount} ／ 正答例と異なる候補 ${linkExtraCount}`
    );
    parts.push("");

    // 理由
    parts.push("■ なぜ注意が必要？");
    if (strong) {
      parts.push(
        "・正答例と異なる候補が混ざると、「何をクラスとして抽象化するか」がブレやすくなります。"
      );
    }
    if (medium) {
      parts.push(
        "・未カバーが残っていると、クラス図に必要なクラスや関連が欠けてしまうことがあります。"
      );
    }
    if (weak && !strong && !medium) {
      parts.push("・未診断のままだと、見落としに気づきにくいです。");
    }
    parts.push("");

    // 行動誘導
    parts.push("■ まず何をすればいい？（おすすめの次の一手）");
    if (!objChecked || !linkChecked) {
      parts.push("・「オブジェクトを診断する」「リンクを診断する」を押して、状態を確認してください。");
    }
    if (objChecked && objExtraCount > 0) {
      parts.push("・「正答例と異なるオブジェクトを見る」で、候補を根拠と照らして確認してください。");
    }
    if (linkChecked && linkExtraCount > 0) {
      parts.push("・「正答例と異なるリンクを見る」で、候補を根拠と照らして確認してください。");
    }
    parts.push("");

    // 注意（それでも進む場合）
    parts.push("■ それでも進む場合");
    parts.push("・根拠があって「正答例と異なる候補」を入れているなら、進んでもOKです。");
    parts.push("・ただし次のクラス図編集で「なぜ入れたか」を説明できる状態にしておくのがおすすめです。");
    parts.push("");
    parts.push("このままクラス図編集へ進みますか？");

    return { needsConfirm: true, message: parts.join("\n") };
  };

  // ===== クラス図編集ページへ遷移（警告＋保存） =====
  const handleConvertAndOpenClassEditor = async () => {
    // ここだけは“警告”ではなく“ブロック”のまま（PlantUML/推定CDが破綻しやすい）
    if (hasUnnamedObject) {
      alert(
        "オブジェクト名が未入力のものがあります。\nすべてのオブジェクトに名前を入力してください。"
      );
      return;
    }

    // まず「状態を保存」してから、警告→遷移の流れにする
    // （OKで進んでも、キャンセルでも保存はされる＝やり直しや比較がしやすい）
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify({ objects, links }));
    } catch {
      // 失敗しても致命ではないので続行
    }

    // 警告（confirm）
    const warn = buildProceedWarningMessage();
    if (warn.needsConfirm) {
      const ok = window.confirm(warn.message);
      if (!ok) return;
    }

    // convert（必要なら取得）
    let result: ConvertResponse | null = null;

    if (classPuml) {
      result = {
        classPuml,
        encodedPuml: encodedClassPuml,
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
        setClassPuml(data.classPuml);
        setEncodedClassPuml(data.encodedPuml);
        setIssues(data.issues ?? null);
        setRelationHints(data.relationHints ?? []);
        result = data;
      } catch (e) {
        console.error(e);
        alert("クラス図への変換で予期しないエラーが発生しました。");
        return;
      }
    }

    if (!result) return;

    // 遷移時にも“編集用payload”を保存
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

    router.push("/experiment/class-editor");
  };

  // ===== オブジェクト図作成問題文のハイライト =====
  const highlightedObjectProblem = useMemo<React.ReactNode>(() => {
    const text = objectProblemText || "";

    const tokens: { text: string; kind: "object" | "link" }[] = [];

    const objName = selectedObject?.name?.trim();
    if (objName) tokens.push({ text: objName, kind: "object" });

    const fromName = selectedLinkFromName;
    const toName = selectedLinkToName;
    if (fromName) tokens.push({ text: fromName, kind: "link" });
    if (toName) tokens.push({ text: toName, kind: "link" });

    return highlightProblemByLine(text, tokens, fromName, toName);
  }, [objectProblemText, selectedObject?.name, selectedLinkFromName, selectedLinkToName]);

  // ===== PlantUML サーバURL =====
  const objectPreviewUrl = useMemo(() => {
    if (!encodedObjectPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}`;
  }, [encodedObjectPuml]);

  const classPreviewUrl = useMemo(() => {
    if (!encodedClassPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedClassPuml}`;
  }, [encodedClassPuml]);

  // 「進む」ボタンは基本押せる。未入力だけは停止。
  const proceedDisabled = hasUnnamedObject;

  const proceedDisabledReason = useMemo(() => {
    if (!proceedDisabled) return "";
    return "オブジェクト名が未入力のものがあります。";
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
          <div className="p-2 border-b font-semibold text-sm">要求文</div>

          <div className="p-2 border-b text-xs flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold">クラス図作成問題文</span>
              <button
                className="text-[10px] px-2 py-0.5 border rounded hover:bg-slate-100"
                onClick={() => setShowClassProblemFull((v) => !v)}
              >
                {showClassProblemFull ? "本文を折りたたむ" : "本文を表示"}
              </button>
            </div>
            <div
              className={
                "mt-1 whitespace-pre-wrap text-[11px] leading-relaxed border rounded bg-slate-50 px-2 py-1 " +
                (showClassProblemFull ? "" : "max-h-[80px] overflow-hidden")
              }
            >
              {classProblemText}
            </div>
          </div>

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
              {highlightedObjectProblem}
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

            {/* ===== オブジェクトアシスト（折りたたみ＋スクロール） ===== */}
            <div
              ref={objAssistScrollRef}
              className={
                "border-b bg-slate-50 overflow-y-auto min-h-0" +
                (objAssistCollapsed ? " h-[56px] flex-none" : " flex-1")
              }
            >
              <AssistHeader
                title="OD作成アシスト（オブジェクト）"
                enabled={objAssist.enabled}
                collapsed={objAssistCollapsed}
                onToggle={() => setObjAssistCollapsed((v) => !v)}
                rightText={
                  objAssist.enabled && objChecked
                    ? `カバー：${objMatchedCount}/${objRequiredCount}　未カバー：${objMissingCount}/${objRequiredCount}　正答例と異なる候補：${objExtraCount}`
                    : undefined
                }
              />

              {!objAssistCollapsed && objAssist.enabled && (
                <div className="p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="px-3 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                      onClick={handleObjDiagnose}
                    >
                      オブジェクトを診断する
                    </button>

                    <button
                      className="px-3 py-1 text-[11px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-50"
                      onClick={handleObjRevealNextExtra}
                      disabled={
                        !objChecked ||
                        objAssist.extraBases.length === 0 ||
                        !objDirtySinceHint ||
                        objRevealExtra >= objAssist.extraBases.length
                      }
                    >
                      正答例と異なるオブジェクトを見る
                    </button>
                  </div>

                  {!objChecked ? (
                    <div className="mt-2 text-[11px] text-slate-600">
                      ※ 「オブジェクトを診断する」で、正答例に対するカバー/未カバーを確認できます
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">
                      <div>
                        カバー：<span className="font-semibold">{objMatchedCount}</span>/
                        {objRequiredCount}　
                        未カバー：<span className="font-semibold">{objMissingCount}</span>/
                        {objRequiredCount}
                      </div>
                      <div className="mt-1 text-slate-500">
                        ※ 未カバーは「正答例にあるのに入力にない」ものの数です（具体名は表示しません）
                      </div>
                    </div>
                  )}

                  {objChecked && objMatchedCount === objRequiredCount && objExtraCount === 0 && (
                    <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                      正答例と一致しています（オブジェクト名の観点）
                    </div>
                  )}

                  {objChecked && objShowExtraError && (
                    <div className="mt-2 border border-red-300 bg-red-50 text-red-700 text-[11px] rounded p-2">
                      <div className="font-semibold">
                        要確認：正答例にない可能性のあるオブジェクトがあります（候補：{objExtraCount}）
                      </div>
                      <ul className="mt-1 list-disc pl-5 space-y-0.5">
                        <li>これは「間違い確定」ではありません。</li>
                        <li>
                          ただし、根拠がないままクラス図に進むと、抽象化（クラス化）が崩れやすくなります。
                        </li>
                        <li>
                          「正答例と異なるオブジェクトを見る」で候補を確認し、根拠がなければ削除/修正してください。
                        </li>
                      </ul>
                    </div>
                  )}

                  {objChecked && objRevealExtra > 0 && (
                    <div className="mt-3 text-[11px]">
                      <div className="font-semibold text-slate-700">
                        正答例と異なる可能性（開示済み：
                        {Math.min(objRevealExtra, objAssist.extraBases.length)}/
                        {objAssist.extraBases.length}）
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {objAssist.extraBases.slice(0, objRevealExtra).map((b) => (
                          <span
                            key={b}
                            className="px-2 py-0.5 rounded border bg-white text-red-700"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                  const isSelected = selectedObjectId === o.id;
                  return (
                    <button
                      key={o.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex items-center justify-between " +
                        (isSelected
                          ? "bg-amber-100 ring-1 ring-amber-400"
                          : "hover:bg-slate-100")
                      }
                      onClick={() => {
                        setSelectedObjectId((prev) => (prev === o.id ? null : o.id));
                        setSelectedLinkId(null);
                      }}
                    >
                      <span className="truncate">{o.name || "(無名オブジェクト)"}</span>
                      <span className="text-[10px] text-slate-500 ml-2">
                        {o.slots.length} スロット
                      </span>
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
                        <label
                          className="block text-[11px] font-semibold mb-1"
                          title={TOOLTIP.objectName}
                        >
                          オブジェクト名
                        </label>
                        <HelpBadge title={TOOLTIP.objectName} />
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-xs"
                        value={selectedObject.name}
                        onChange={(e) =>
                          handleUpdateObjectName(selectedObject.id, e.target.value)
                        }
                        onFocus={() => setEditingObjectId(selectedObject.id)}
                        onBlur={() => setEditingObjectId(null)}
                        placeholder="例）学生1、授業A など"
                        title={TOOLTIP.objectName}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center">
                          <span
                            className="text-[11px] font-semibold"
                            title={`${TOOLTIP.slotKey}\n${TOOLTIP.slotValue}`}
                          >
                            スロット（スロット名 と 値）
                          </span>
                          <HelpBadge title={`${TOOLTIP.slotKey}\n${TOOLTIP.slotValue}`} />
                        </div>

                        <button
                          className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                          onClick={handleAddSlotToSelected}
                        >
                          ＋ スロット追加
                        </button>
                      </div>

                      {selectedObject.slots.length === 0 && (
                        <div className="text-[11px] text-slate-500 mb-1">
                          例）スロット名：年齢、値：19 など
                        </div>
                      )}

                      <div className="flex flex-col gap-1">
                        {selectedObject.slots.map((s, idx) => (
                          <div
                            key={idx}
                            className="border rounded px-2 py-1 bg-white flex flex-col gap-2"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.key}
                                onChange={(e) =>
                                  handleUpdateSlot(idx, { key: e.target.value })
                                }
                                placeholder="スロット名（例：年齢）"
                                title={TOOLTIP.slotKey}
                              />
                              <span className="text-[11px] text-slate-400">=</span>
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.value}
                                onChange={(e) =>
                                  handleUpdateSlot(idx, { value: e.target.value })
                                }
                                placeholder={'値（例：19、"文学" など）'}
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
              <span className="font-semibold text-sm">オブジェクト図プレビュー（リアルタイム）</span>
              <span className="text-[11px] text-slate-500">
                上でオブジェクトやリンクを編集すると、ここに反映されます。
              </span>
            </div>
            <div className="flex-1 overflow-auto bg-white">
              {!objectPreviewUrl && (
                <div className="p-3 text-[11px] text-slate-500">
                  オブジェクトやリンクを入力すると、ここにオブジェクト図が表示されます。
                </div>
              )}
              {objectPreviewUrl && (
                <iframe
                  src={objectPreviewUrl}
                  className="w-full h-full"
                  title="オブジェクト図プレビュー"
                />
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

            {/* ===== リンクアシスト（折りたたみ＋スクロール） ===== */}
            <div
              ref={linkAssistScrollRef}
              className={
                "border-b bg-slate-50 overflow-y-auto min-h-0" +
                (linkAssistCollapsed ? " h-[56px] flex-none" : " flex-1")
              }
            >
              <AssistHeader
                title="OD作成アシスト（リンク）"
                enabled={linkAssist.enabled}
                collapsed={linkAssistCollapsed}
                onToggle={() => setLinkAssistCollapsed((v) => !v)}
                rightText={
                  linkAssist.enabled && linkChecked
                    ? `カバー：${linkMatchedCount}/${linkRequiredCount}　未カバー：${linkMissingCount}/${linkRequiredCount}　正答例と異なる候補：${linkExtraCount}`
                    : undefined
                }
              />

              {!linkAssistCollapsed && linkAssist.enabled && (
                <div className="p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="px-3 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                      onClick={handleLinkDiagnose}
                    >
                      リンクを診断する
                    </button>

                    <button
                      className="px-3 py-1 text-[11px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-50"
                      onClick={handleLinkRevealNextExtra}
                      disabled={
                        !linkChecked ||
                        linkAssist.extraLinks.length === 0 ||
                        !linkDirtySinceHint ||
                        linkRevealExtra >= linkAssist.extraLinks.length
                      }
                    >
                      正答例と異なるリンクを見る
                    </button>
                  </div>

                  {!linkChecked ? (
                    <div className="mt-2 text-[11px] text-slate-600">
                      ※ 「リンクを診断する」で、正答例に対するカバー/未カバーを確認できます（端点のみ）
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">
                      <div>
                        カバー：<span className="font-semibold">{linkMatchedCount}</span>/
                        {linkRequiredCount}　
                        未カバー：<span className="font-semibold">{linkMissingCount}</span>/
                        {linkRequiredCount}
                      </div>
                      <div className="mt-1 text-slate-500">
                        ※ 未カバーは「正答例にあるのに入力にない」端点ペアの数です（具体名は表示しません）
                      </div>
                    </div>
                  )}

                  {linkChecked && linkMatchedCount === linkRequiredCount && linkExtraCount === 0 && (
                    <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                      正答例と一致しています（リンク端点の観点）
                    </div>
                  )}

                  {linkChecked && linkShowExtraError && (
                    <div className="mt-2 border border-red-300 bg-red-50 text-red-700 text-[11px] rounded p-2">
                      <div className="font-semibold">
                        要確認：正答例にない可能性のあるリンク（端点）があります（候補：{linkExtraCount}）
                      </div>
                      <ul className="mt-1 list-disc pl-5 space-y-0.5">
                        <li>これは「間違い確定」ではありません。</li>
                        <li>
                          ただし、根拠がないままクラス図に進むと、抽象化（クラス化）が崩れやすくなります。
                        </li>
                        <li>
                          「正答例と異なるリンクを見る」で候補を確認し、根拠がなければ削除/修正してください。
                        </li>
                      </ul>
                    </div>
                  )}

                  {linkChecked && linkRevealExtra > 0 && (
                    <div className="mt-3 text-[11px]">
                      <div className="font-semibold text-slate-700">
                        正答例と異なる可能性（開示済み：
                        {Math.min(linkRevealExtra, linkAssist.extraLinks.length)}/
                        {linkAssist.extraLinks.length}）
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {linkAssist.extraLinks.slice(0, linkRevealExtra).map((p) => (
                          <span
                            key={p.fullKey}
                            className="px-2 py-0.5 rounded border bg-white text-red-700"
                          >
                            {p.pretty}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {linkChecked && linkAssist.labelWarnings.length > 0 && (
                    <div className="mt-3 border border-amber-300 bg-amber-50 text-amber-900 text-[11px] rounded p-2">
                      <div className="font-semibold">
                        注意：リンクラベルが正答例と異なる可能性があります
                      </div>
                      <div className="mt-1 space-y-1">
                        {linkAssist.labelWarnings.slice(0, 6).map((w, idx) => (
                          <div key={idx}>
                            <span className="font-semibold">{w.pretty}</span>{" "}
                            期待：{w.expected.join(" / ")} ／ 入力：{w.actual}
                          </div>
                        ))}
                        {linkAssist.labelWarnings.length > 6 && (
                          <div className="text-amber-800">
                            …他 {linkAssist.labelWarnings.length - 6} 件
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                  const isSelected = selectedLinkId === l.id;
                  return (
                    <button
                      key={l.id}
                      className={
                        "w-full text-left px-2 py-1 border-b flex flex-col " +
                        (isSelected
                          ? "bg-rose-100 ring-1 ring-rose-400"
                          : "hover:bg-slate-100")
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
                        <label
                          className="block text-[11px] font-semibold mb-1"
                          title={TOOLTIP.linkEndpoints}
                        >
                          リンク（関係を持つオブジェクト）
                        </label>
                        <HelpBadge title={TOOLTIP.linkEndpoints} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="border rounded px-1 py-0.5 text-[11px]"
                          value={selectedLink.from}
                          onChange={(e) =>
                            handleUpdateLink(selectedLink.id, { from: e.target.value })
                          }
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
                          onChange={(e) =>
                            handleUpdateLink(selectedLink.id, { to: e.target.value })
                          }
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
                        <label
                          className="block text-[11px] font-semibold mb-1"
                          title={TOOLTIP.linkLabel}
                        >
                          リンクラベル（関係を説明する動詞）
                        </label>
                        <HelpBadge title={TOOLTIP.linkLabel} />
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-[11px]"
                        value={selectedLink.label}
                        onChange={(e) =>
                          handleUpdateLink(selectedLink.id, { label: e.target.value })
                        }
                        placeholder="例）履修する、担当する など"
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
            </div>

            <div className="flex-1 overflow-auto bg-white flex flex-col">
              {hasUnnamedObject && (
                <div className="p-3 text-[11px] text-slate-600">
                  推定クラス図は一時停止中です。<br />
                  <span className="font-semibold">オブジェクト名が未入力</span>のものがあるため、
                  すべてのオブジェクトに名前を入力してください。
                </div>
              )}

              {!hasUnnamedObject && !encodedClassPuml && (
                <div className="p-3 text-[11px] text-slate-500">
                  オブジェクトとリンクを入力すると、ここに推定クラス図が表示されます。
                </div>
              )}

              {!hasUnnamedObject && encodedClassPuml && (
                <div className="flex-1 flex flex-col">
                  {classPreviewUrl && (
                    <div className="flex-1 overflow-auto border-b">
                      <iframe src={classPreviewUrl} className="w-full h-full" title="推定クラス図" />
                    </div>
                  )}

                  {issues && (
                    <div className="p-2 text-[11px] border-t bg-slate-50">
                      <div className="font-semibold mb-1">推定クラス図のチェック結果</div>
                      {issues.classes.length === 0 && (
                        <div className="text-slate-500">
                          特に未完成・矛盾のある属性は見つかりませんでした。
                        </div>
                      )}
                      {issues.classes.map((c) => (
                        <div key={c.name} className="mb-1">
                          <div className="font-semibold">{c.name}</div>
                          {c.incomplete.length > 0 && (
                            <div className="text-amber-700">
                              未入力の可能性がある属性: {c.incomplete.join(", ")}
                            </div>
                          )}
                          {c.contradictory.length > 0 && (
                            <div className="text-red-700">
                              型が混在している属性: {c.contradictory.join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
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