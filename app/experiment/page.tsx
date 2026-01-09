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

  // 図やチェック結果に出る型トークンを、日本語の理解を助ける形にする
  // ※ PlantUML自体は英語トークンでOK。ここは表示補助だけ。
  return (raw ?? "")
    .replace(/\bstring\b/g, "文字列")
    .replace(/\bint\b/g, "整数")
    .replace(/\breal\b/g, "小数")
    .replace(/\bboolean\b/g, "真偽値");
};

const sanitizeClassPumlForLearner = (puml: string) => {
  if (!puml) return puml;

  let out = puml;

  // === 型混在（<!>）の表現を「型が混在」に寄せる（型名は表示しない） ===
  // 例）氏名: string <!>  -> 氏名: （型が混在）
  out = out.replace(
    /:\s*([A-Za-z_][\w]*)\s*<!>\s*$/gm,
    ": （型が混在）"
  );

  // === 値が1つも無い（<?>）の表現を「値が未入力」に寄せる（型名は表示しない） ===
  // 例）氏名: string <?>  -> 氏名: （値が未入力）
  out = out.replace(
    /:\s*([A-Za-z_][\w]*)\s*<\?>\s*$/gm,
    ": （値が未入力）"
  );
  // まれに型名が無いまま<?>だけ付くケース
  out = out.replace(/:\s*<\?>\s*$/gm, ": （値が未入力）");

  // === クラスのステレオタイプを初学者向けに ===
  out = out.replace(/<<\s*contradictory\s*>>/g, "<<型が混在>>");
  out = out.replace(/<<\s*incomplete\s*>>/g, "<<値が未入力>>");

  // 念のため、残っているマーカーは見やすい日本語に
  out = out.replace(/<!>/g, "（型が混在）");
  out = out.replace(/<\?>/g, "（値が未入力）");

  return out;
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

// スロットキー（スロット名）の正規化（値は見ない方針B）
const normalizeSlotKey = (raw: string) => {
  return stripHtmlTags(raw ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "");
};

// PlantUMLのスロット行から「キー（属性名）」だけ取り出す（: / = どちらにも対応）
const extractSlotKeyFromPumlLine = (line: string) => {
  const t = (line ?? "").trim();
  if (!t) return "";
  const m = t.match(/^(.+?)\s*[:=]/);
  return (m?.[1] ?? t).trim();
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

// 正答PUMLから「ベース名 -> 必須スロットキー集合」を抽出（方針B：キーのみ）
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

    // object 開始行
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

      // { が同じ行にあるなら直ちに開始
      if (t.includes("{")) {
        startBlock(base);
      } else {
        // 次の行が { の場合に備える
        pendingBase = base;
        currentBase = null;
        inBlock = false;
      }
      continue;
    }

    // object の直後に { が来るケース
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

      // スロット行（例：氏名: "佐藤" / 会員番号: 1001）
      // 値は見ない（キーだけ）
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

// --- プレビュー拡大・縮小（SVGの縦横比を崩さない） ---
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const [objectZoom, setObjectZoom] = useState(1);
const [classZoom, setClassZoom] = useState(1);


  // --- 問題文の表示制御 ---
  const [showClassProblemFull, setShowClassProblemFull] = useState(false);
  const [showObjectProblemFull, setShowObjectProblemFull] = useState(false);

  // ===== アシスト状態（オブジェクト） =====
  const [objChecked, setObjChecked] = useState(false); // ← 診断済みフラグとして使う
  const [objDiagnoseSnapshot, setObjDiagnoseSnapshot] =
    useState<ObjDiagnoseSnapshot | null>(null);
  const [objRevealExtra, setObjRevealExtra] = useState(0);
  const [objDirtySinceHint, setObjDirtySinceHint] = useState(false);

  // ===== アシスト状態（リンク） =====
  const [linkChecked, setLinkChecked] = useState(false); // ← 診断済みフラグとして使う
  const [linkDiagnoseSnapshot, setLinkDiagnoseSnapshot] =
    useState<LinkDiagnoseSnapshot | null>(null);
  const [linkRevealExtra, setLinkRevealExtra] = useState(0);
  const [linkDirtySinceHint, setLinkDirtySinceHint] = useState(false);

  // 「正答例と異なる〜を見る」を“編集後に解禁”するための誘導表示
  const [objRevealUnlockedNotice, setObjRevealUnlockedNotice] = useState(false);
  const [linkRevealUnlockedNotice, setLinkRevealUnlockedNotice] = useState(false);

  const prevObjRevealCanProceedRef = useRef(false);
  const prevLinkRevealCanProceedRef = useRef(false);

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
    // ===== パターン1（オブジェクト不足/過剰）＋スロット（キー）不足（方針B） =====
  const objAssist = useMemo(() => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);

    // --- 正答：必要オブジェクト（ベース名） ---
    const requiredBases = new Set<string>();
    if (enabled) {
      const labels = extractObjectLabelsFromPuml(objectAnswerPuml);
      for (const raw of labels) {
        const base = baseNameForAssist(raw);
        if (base) requiredBases.add(base);
      }
    }

    // --- 入力：存在オブジェクト（ベース名） ---
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

    // --- 正答：必要スロットキー（ベース名ごとに集合） ---
    const requiredSlotKeysByBase = enabled
      ? extractRequiredSlotKeysByBaseFromPuml(objectAnswerPuml)
      : new Map<string, Set<string>>();

    // --- 入力：スロットキー（ベース名ごとに集合） ---
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

    // --- スロット（キー）の未カバー数（具体名は出さない） ---
    // ※初学者の混乱回避のため、ここは「オブジェクト名がカバーされているもの」だけを対象にする。
    //   （オブジェクト名が未カバーの間は、そのオブジェクトのスロットは評価しない）
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

    // --- 参考：正答にないスロットキー（過剰候補：スロット名の観点） ---
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
	const objExtraCount = objSnapshot ? objSnapshot.extraCount : objAssist.extraBases.length;

	const objSlotRequiredTotal = objSnapshot
	  ? objSnapshot.slotRequiredTotal
	  : objAssist.requiredSlotKeyTotal;
	const objSlotMissingTotal = objSnapshot
	  ? objSnapshot.slotMissingTotal
	  : objAssist.missingSlotKeyTotal;
	const objSlotMatchedTotal = objSnapshot
	  ? objSnapshot.slotMatchedTotal
	  : objAssist.matchedSlotKeyTotal;
	const objExtraSlotCount = objSnapshot ? objSnapshot.extraSlotCount : objAssist.extraSlotKeyTotal;

	const objExtraBasesForReveal = objSnapshot ? objSnapshot.extraBases : objAssist.extraBases;

	// ===== A案表示用（入力側を分母にする） =====
	const objInputTotal = objSnapshot
	  ? objSnapshot.inputTotal
	  : objects.filter((o) => !!(o.name && o.name.trim().length > 0) && !(editingObjectId && o.id === editingObjectId)).length;
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
      return "次の候補を見るには、診断後にオブジェクト図を一度修正してください（例：オブジェクト名／スロット名の追加・修正・削除）。";
    return null;
	}, [objChecked, objExtraBasesForReveal.length, objRevealExtra, objDirtySinceHint]);

  const objRevealDisabled = objRevealDisabledReason !== null;

  const objRevealNeedsEdit =
    objChecked &&
    objExtraBasesForReveal.length > 0 &&
    objRevealExtra < objExtraBasesForReveal.length &&
    !objDirtySinceHint;

  const objRevealCanProceed =
    objChecked &&
    objExtraBasesForReveal.length > 0 &&
    objRevealExtra < objExtraBasesForReveal.length &&
    objDirtySinceHint;

  useEffect(() => {
    // 「編集したらボタンが使えるようになった」ことを明示（初学者向け誘導）
    const prev = prevObjRevealCanProceedRef.current;
    prevObjRevealCanProceedRef.current = objRevealCanProceed;
    if (!prev && objRevealCanProceed) {
      setObjRevealUnlockedNotice(true);
      const t = window.setTimeout(() => setObjRevealUnlockedNotice(false), 2500);
      return () => window.clearTimeout(t);
    }
  }, [objRevealCanProceed]);

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

  // --- リンク診断結果（スナップショット優先） ---
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

  // ===== A案表示用（入力側を分母にする） =====
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
          const endpointKey = `${fromBase} -> ${toBase}`;
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
      return "次の候補を見るには、診断後にリンク（端点/ラベル）を一度修正してください（例：端点の変更、ラベル入力、不要なら削除）。";
    return null;
  }, [
    linkChecked,
    linkExtraLinksForReveal.length,
    linkRevealExtra,
    linkDirtySinceHint,
  ]);

  const linkRevealDisabled = linkRevealDisabledReason !== null;

  const linkRevealNeedsEdit =
    linkChecked &&
    linkExtraLinksForReveal.length > 0 &&
    linkRevealExtra < linkExtraLinksForReveal.length &&
    !linkDirtySinceHint;

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

  // ===== オブジェクトアシスト操作 =====
  const handleObjDiagnose = () => {
    // 診断ボタンを押した瞬間の結果を保存し、以降はリアルタイム反映しない
    setObjChecked(true);

    // ===== A案：分母を「正答例の数」ではなく「入力した数」に寄せて表示する =====
    const inputObjs = objects.filter((o) => {
      if (editingObjectId && o.id === editingObjectId) return false;
      return !!(o.name && o.name.trim().length > 0);
    });
    const inputTotal = inputObjs.length;
    const inputMatched = inputObjs.filter((o) => {
      const base = baseNameForAssist(o.name);
      return objAssist.requiredBases.has(base);
    }).length;
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
    });

    // 追加開示は診断し直すたびにリセット
    setObjRevealExtra(0);
    setObjDirtySinceHint(false);
  };

  const handleObjRevealNextExtra = () => {
    if (!objChecked) return alert("まず「オブジェクトを診断する」を押してください。");
    if (objExtraBasesForReveal.length === 0) return;
    if (!objDirtySinceHint)
      return alert("次の表示を見る前に、オブジェクト図を一度修正してください。");
    if (objRevealExtra >= objExtraBasesForReveal.length) return;

    setObjAssistCollapsed(false);
    setObjRevealExtra((c) => c + 1);
    setObjDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // 学習者の要望で「編集せずに表示」も可能（ただし学習効果のため confirm を挟む）
  const handleObjRevealNextExtraForce = () => {
    if (!objChecked) return alert("まず「オブジェクトを診断する」を押してください。");
    if (objExtraBasesForReveal.length === 0) return;
    if (objRevealExtra >= objExtraBasesForReveal.length) return;

    const ok = window.confirm(
      "編集せずに次の候補を表示します。\n（学習のためには『修正→表示』をおすすめします）\n表示しますか？"
    );
    if (!ok) return;

    setObjAssistCollapsed(false);
    setObjRevealExtra((c) => c + 1);
    setObjDirtySinceHint(false);
    scrollObjAssistToBottom();
  };


  // ===== リンクアシスト操作 =====
  const handleLinkDiagnose = () => {
    setLinkChecked(true);
    // リンク診断結果も「押した時点」で固定表示する
    // ===== A案：分母を「正答例の数」ではなく「入力した数」に寄せて表示する =====
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
      const pretty = label ? `${aBase} — ${bBase}（${label}）` : `${aBase} — ${bBase}`;
      presentLinks.push({ a: aBase, b: bBase, label, endpointKey, fullKey, pretty });
    }
    const inputTotal = presentLinks.length;
    const inputMatched = presentLinks.filter((p) => linkAssist.requiredEndpointKeys.has(p.endpointKey)).length;
    const inputUnmatched = Math.max(0, inputTotal - inputMatched);

    const requiredCount = linkAssist.requiredEndpointKeys.size;
    const missingCount = linkAssist.missingPretty.length;
    const extraCount = linkAssist.extraLinks.length;

    setLinkDiagnoseSnapshot({
      inputTotal,
      inputMatched,
      inputUnmatched,
      requiredCount,
      missingCount,
      extraCount,
      extraLinks: linkAssist.extraLinks,
      labelWarnings: linkAssist.labelWarnings,
    });

    // 診断し直し＝開示状態もリセット
    setLinkRevealExtra(0);
    setLinkDirtySinceHint(false);
  };

  const handleLinkRevealNextExtra = () => {
    if (!linkChecked) return alert("まず「リンクを診断する」を押してください。");
    if (linkExtraLinksForReveal.length === 0) return;
    if (!linkDirtySinceHint)
      return alert(
        "次の候補を見る前に、リンク（端点/ラベル）を一度修正してください。\n\n" +
          "このボタンは『修正→確認→次の候補』の順で、ヒントを少しずつ開示するためのものです。\n" +
          "（すぐに見たい場合は、右の「今すぐ表示」を使えます）"
      );
    if (linkRevealExtra >= linkExtraLinksForReveal.length) return;

    setLinkAssistCollapsed(false);
    setLinkRevealExtra((c) => c + 1);
    setLinkDirtySinceHint(false);
    scrollLinkAssistToBottom();
  };

  const handleLinkRevealNextExtraForce = () => {
    if (!linkChecked) return alert("まず「リンクを診断する」を押してください。");
    if (linkExtraLinksForReveal.length === 0) return;
    if (linkRevealExtra >= linkExtraLinksForReveal.length) return;

    const ok = window.confirm(
      "編集せずに次の候補を表示します。\n（学習のためには『修正→表示』をおすすめします）\n表示しますか？"
    );
    if (!ok) return;

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
    // スロット操作も「編集」として扱い、次のヒント解禁につなげる
    markMeaningfulChange(true, false);
  };

  const handleUpdateSlot = (index: number, partial: Partial<Slot>) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.map((s, i) => (i === index ? { ...s, ...partial } : s));
    setObjects((prev) =>
      prev.map((o) => (o.id === selectedObject.id ? { ...o, slots: newSlots } : o))
    );
    markMeaningfulChange(true, false);
  };

  const handleDeleteSlot = (index: number) => {
    if (!selectedObject) return;
    const newSlots = selectedObject.slots.filter((_, i) => i !== index);
    setObjects((prev) =>
      prev.map((o) => (o.id === selectedObject.id ? { ...o, slots: newSlots } : o))
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
	      // 復元直後は再診断してもらう（診断結果は固定表示のため）
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
    if (!window.confirm("オブジェクトとリンクをすべて削除します。よろしいですか？")) return;
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
      `・オブジェクト：正答にある名前 ${objInputMatched}/${objInputTotal} ／ 正答にない名前 ${objInputUnmatched}/${objInputTotal} ／ 正答にあるが未入力 ${objMissingCount} ／ 正答例と異なる候補 ${objExtraCount}`
    );
    parts.push(
      `・リンク：正答にある端点 ${linkInputMatched}/${linkInputTotal} ／ 正答にない端点 ${linkInputUnmatched}/${linkInputTotal} ／ 正答にあるが未入力 ${linkMissingCount} ／ 正答例と異なる候補 ${linkExtraCount}`
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
        "・不足が残っていると、クラス図に必要なクラスや関連が欠けてしまうことがあります。"
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

  
  // ===== 表示用（学習者向け）クラス図PUML（型混在表記などを調整） =====
  const displayClassPuml = useMemo(() => {
    return sanitizeClassPumlForLearner(classPuml);
  }, [classPuml]);

  const displayEncodedClassPuml = useMemo(() => {
    if (!displayClassPuml) return "";
    try {
      return plantumlEncoder.encode(displayClassPuml);
    } catch {
      return "";
    }
  }, [displayClassPuml]);

// ===== PlantUML サーバURL =====
  const objectPreviewUrl = useMemo(() => {
    if (!encodedObjectPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${encodedObjectPuml}`;
  }, [encodedObjectPuml]);

  const classPreviewUrl = useMemo(() => {
    if (!displayEncodedClassPuml) return "";
    return `https://www.plantuml.com/plantuml/svg/${displayEncodedClassPuml}`;
  }, [displayEncodedClassPuml]);

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
                    ? `正答にある：${objInputMatched}/${objInputTotal}　正答にない：${objInputUnmatched}/${objInputTotal}　正答にあるが未入力：${objMissingCount}　正答例と異なる候補：${objExtraCount}`
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

                    
                    <div className="relative inline-block group" title={objRevealDisabled ? (objRevealDisabledReason ?? "") : ""}>
                      <button
                        className={
                          "px-3 py-1 text-[11px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-50 disabled:cursor-not-allowed" +
                          (objRevealCanProceed ? " ring-2 ring-emerald-300 animate-pulse" : "")
                        }
                        onClick={handleObjRevealNextExtra}
                        disabled={objRevealDisabled}
                        aria-describedby={
                          objRevealDisabled ? "obj-reveal-disabled-tip" : undefined
                        }
                      >
                        正答例と異なるオブジェクトを見る
                      </button>

                      {objRevealDisabled && (
                        <>
                          <span
                            className="absolute inset-0 cursor-not-allowed"
                            aria-hidden="true"
                          />
                          <div
                            id="obj-reveal-disabled-tip"
                            role="tooltip"
                            className="pointer-events-none absolute left-0 top-full mt-1 z-20 w-[280px] rounded border bg-white px-2 py-1 text-[11px] text-slate-700 shadow
                                       opacity-0 translate-y-1 transition
                                       group-hover:opacity-100 group-hover:translate-y-0"
                          >
                            {objRevealDisabledReason}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {objChecked && objExtraBasesForReveal.length > 0 && objRevealExtra < objExtraBasesForReveal.length && (
                    <div className="mt-2 text-[11px]">
                      {objRevealCanProceed ? (
                        <div className="text-emerald-700">
                          ✅ 編集を検知しました。<span className="font-semibold">「正答例と異なるオブジェクトを見る」</span>が押せます。
                          {objRevealUnlockedNotice && (
                            <span className="ml-2 inline-flex items-center rounded border bg-emerald-50 border-emerald-200 px-2 py-0.5 text-[10px]">
                              ボタンが解禁されました
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-slate-600">
                          🔒 次の候補を見るには、オブジェクト図を一度修正してください（例：名前/スロット名の修正、追加、削除）。
                          <button
                            type="button"
                            className="ml-2 underline text-sky-700 hover:text-sky-800"
                            onClick={handleObjRevealNextExtraForce}
                            title="学習効果のため通常は『修正→表示』をおすすめします"
                          >
                            編集せずに表示
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {!objChecked ? (
                    <div className="mt-2 text-[11px] text-slate-600">
                      ※ 「オブジェクトを診断する」で、
                      あなたが入力したオブジェクト名が正答例に含まれるか／正答例にあるのに未入力のものがあるかを確認できます
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold">あなたの入力（オブジェクト名）</span>：
                        正答に含まれる <span className="font-semibold">{objInputMatched}</span>/{objInputTotal}　
                        正答にない <span className="font-semibold">{objInputUnmatched}</span>/{objInputTotal}
                      </div>

                      <div className="mt-1">
                        <span className="font-semibold">正答にあるが未入力</span>：
                        <span className="font-semibold">{objMissingCount}</span> 件
                        <span className="text-slate-500">（具体名は表示しません）</span>
                      </div>

                      {objSlotRequiredTotal > 0 && (
                        <div className="mt-1">
                          <span className="font-semibold">必須スロット名</span>
                          <span className="text-slate-500">（正答に含まれるオブジェクトだけ）</span>：
                          OK <span className="font-semibold">{objSlotMatchedTotal}</span>/{objSlotRequiredTotal}　
                          不足 <span className="font-semibold">{objSlotMissingTotal}</span>/{objSlotRequiredTotal}
                        </div>
                      )}

                      {objSlotRequiredTotal > 0 && (
                        <div className="mt-1 text-slate-500">
                          ※ スロット名の診断は「正答に含まれるオブジェクト」だけが対象です（未入力オブジェクトの中身は見ません）。
                          スロットは「名前（キー）」のみ確認し、値は見ません。
                        </div>
                      )}

                      <div className="mt-1 text-slate-500">
                        ※ ここでの表示はあくまでヒントです。根拠があって正答例と異なる要素を入れているなら、そのままでもOKです。
                      </div>
</div>
                  )}

                  {objChecked && objMissingCount === 0 && objExtraCount === 0 && (objSlotRequiredTotal === 0 || objSlotMissingTotal === 0) && (
                    <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                      正答例と一致しています（オブジェクト名／スロット名の観点）
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
                        {Math.min(objRevealExtra, objExtraBasesForReveal.length)}/
                        {objExtraBasesForReveal.length}）
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {objExtraBasesForReveal.slice(0, objRevealExtra).map((b) => (
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
                  onChange={(e) =>
                    setObjectZoom(clampZoom(parseFloat(e.currentTarget.value)))
                  }
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
                  <img
                    src={objectPreviewUrl}
                    alt="オブジェクト図プレビュー"
                    className="block max-w-none h-auto"
                  />
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
                    ? `正答にある：${linkInputMatched}/${linkInputTotal}　正答にない：${linkInputUnmatched}/${linkInputTotal}　正答にあるが未入力：${linkMissingCount}　正答例と異なる候補：${linkExtraCount}`
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

                    
                    <div className="relative inline-block group" title={linkRevealDisabled ? (linkRevealDisabledReason ?? "") : ""}>
                      <button
                        className={
                          "px-3 py-1 text-[11px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-50 disabled:cursor-not-allowed" +
                          (linkRevealCanProceed ? " ring-2 ring-emerald-300 animate-pulse" : "")
                        }
                        onClick={handleLinkRevealNextExtra}
                        disabled={linkRevealDisabled}
                        aria-describedby={
                          linkRevealDisabled ? "link-reveal-disabled-tip" : undefined
                        }
                      >
                        正答例と異なるリンクを見る
                      </button>

                      {linkRevealDisabled && (
                        <>
                          <span
                            className="absolute inset-0 cursor-not-allowed"
                            aria-hidden="true"
                          />
                          <div
                            id="link-reveal-disabled-tip"
                            role="tooltip"
                            className="pointer-events-none absolute left-0 top-full mt-1 z-20 w-[320px] rounded border bg-white px-2 py-1 text-[11px] text-slate-700 shadow
                                       opacity-0 translate-y-1 transition
                                       group-hover:opacity-100 group-hover:translate-y-0"
                          >
                            {linkRevealDisabledReason}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {linkChecked && linkExtraLinksForReveal.length > 0 && linkRevealExtra < linkExtraLinksForReveal.length && (
                    <div className="mt-2 text-[11px]">
                      {linkRevealCanProceed ? (
                        <div className="text-emerald-700">
                          ✅ 編集を検知しました。<span className="font-semibold">「正答例と異なるリンクを見る」</span>が押せます。
                          {linkRevealUnlockedNotice && (
                            <span className="ml-2 inline-flex items-center rounded border bg-emerald-50 border-emerald-200 px-2 py-0.5 text-[10px]">
                              ボタンが解禁されました
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-slate-600">
                          🔒 次の候補を見るには、リンク（端点/ラベル）を一度修正してください（例：端点変更、ラベル入力、削除）。
                          <button
                            type="button"
                            className="ml-2 underline text-sky-700 hover:text-sky-800"
                            onClick={handleLinkRevealNextExtraForce}
                            title="学習効果のため通常は『修正→表示』をおすすめします"
                          >
                            編集せずに表示
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {!linkChecked ? (
                    <div className="mt-2 text-[11px] text-slate-600">
                      ※ 「リンクを診断する」で、
                      あなたが入力したリンク端点が正答例に含まれるか／正答例にあるのに未入力の端点ペアがあるかを確認できます（端点のみ）
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold">入力したリンク（端点）</span>：
                        正答に含まれる <span className="font-semibold">{linkInputMatched}</span>/{linkInputTotal} ／
                        正答にない <span className="font-semibold">{linkInputUnmatched}</span>/{linkInputTotal}
                      </div>

                      <div className="mt-1">
                        <span className="font-semibold">正答にあるが未入力</span>：
                        <span className="font-semibold">{linkMissingCount}</span> 件
                        <span className="text-slate-500">（具体名は表示しません）</span>
                      </div>

                      <div className="mt-1 text-slate-500">
                        ※ 表示はあくまでヒントです。根拠があって正答例と異なるリンクを入れているなら、そのままでもOKです。
                      </div>
                    </div>
                  )}

                  {linkChecked && linkMissingCount === 0 && linkExtraCount === 0 && (
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
                        {Math.min(linkRevealExtra, linkExtraLinksForReveal.length)}/
                        {linkExtraLinksForReveal.length}）
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {linkExtraLinksForReveal.slice(0, linkRevealExtra).map((p) => (
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

                  {linkChecked && linkLabelWarningsForDisplay.length > 0 && (
                    <div className="mt-3 border border-amber-300 bg-amber-50 text-amber-900 text-[11px] rounded p-2">
                      <div className="font-semibold">
                        注意：リンクラベルが正答例と異なる可能性があります
                      </div>
                      <div className="mt-1 space-y-1">
                        {linkLabelWarningsForDisplay.slice(0, 6).map((w, idx) => (
                          <div key={idx}>
                            <span className="font-semibold">{w.pretty}</span>{" "}
                            期待：{w.expected.join(" / ")} ／ 入力：{w.actual}
                          </div>
                        ))}
                        {linkLabelWarningsForDisplay.length > 6 && (
                          <div className="text-amber-800">
                            …他 {linkLabelWarningsForDisplay.length - 6} 件
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

              
              <div className="flex items-center gap-2">

              <div className="flex items-center mr-2">
                <span className="text-[11px] text-slate-500">型の見方</span>
                <HelpBadge title={TYPE_LEGEND_TOOLTIP} />
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
                  onChange={(e) =>
                    setClassZoom(clampZoom(parseFloat(e.currentTarget.value)))
                  }
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
                  <span className="font-semibold">オブジェクト名が未入力</span>のものがあるため、
                  すべてのオブジェクトに名前を入力してください。
                </div>
              )}

              {!hasUnnamedObject && displayEncodedClassPuml && (
                <div className="flex-1 flex flex-col">
                  {classPreviewUrl && (
                    <div
                    className="flex-1 overflow-auto border-b bg-white p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <div style={{ zoom: classZoom }} className="inline-block origin-top-left">
                      <img
                        src={classPreviewUrl}
                        alt="推定クラス図"
                        className="block max-w-none h-auto"
                      />
                    </div>
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
                              値が未入力の属性（値が1つも入っていない）: {c.incomplete.map(explainTypeText).join(", ")}
                            </div>
                          )}
                          {c.contradictory.length > 0 && (
                            <div className="text-red-700">
                              型が混在している属性: {c.contradictory.map(explainTypeText).join(", ")}
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