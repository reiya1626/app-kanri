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

  // ★ スロット名（キー）の差分（baseごと）
  // 要望：スロット名は「正答例と異なる入力（= 入力にのみ含まれるスロット名）」だけ表示する
  slotDiffs: {
    base: string;
    onlyInInput: string[]; // 入力にのみ含まれるスロット名（= 正答例と一致しない入力）
  }[];
};

// 「リンクを診断する」を押した時点の結果を固定表示するためのスナップショット
// ★評価基準は端点のみ（ラベルは任意）なので、期待ラベル等は一切保持しない
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

// ベース名化（＝診断で使うオブジェクト名のキー）
//
// 以前は「学生1→学生」のように末尾番号などを削除して同一視していましたが、
// 正答例との“完全一致”を見たい用途では個体が混ざって診断が曖昧になります。
// そのため、ここでは末尾番号などの削除は行わず、表示上のノイズだけ除去します。
//
// - HTMLタグ除去
// - 前後空白の除去
// - 「:」以降の除去（"学生: インスタンス" → "学生" のような表記を吸収）
// - 両端の " を除去
const baseNameForAssist = (name: string) => {
  return normalizeObjectLabel(name);
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
  a: string; // base
  b: string; // base
  label: string; // normalized label
  endpointKey: string; // endpoints only
  fullKey: string; // endpoints + label (for warnings / uniq)
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
    "【インスタンス名】現実世界の具体物を識別するための名前です．。",
  slotKey:
    "【スロット名（属性名）】オブジェクトが持つ情報の名前です。",
  slotValue:
    "【スロット値】属性の具体的な値です。数値はそのまま、文字は \"...\" として扱われます。",
  linkEndpoints:
    "【リンク（関係）】オブジェクト同士の関係です。ここで「どのオブジェクトとどのオブジェクトが関係を持つか」を指定します。",
  linkLabel:
    "【リンクラベル】関係の意味を短い言葉で表します．行為や関係を表す表現が使われることが多い",
} as const;

// ===== ラベル用の ?（クリックで説明を表示） =====
// 画面録画などで「ホバー状態」が拾えないことがあるため、クリックで開閉する。
const HelpBadge: React.FC<{ title: string }> = ({ title }) => {
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
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 text-[10px] text-slate-600 bg-white cursor-pointer underline decoration-dotted"
        aria-label="用語の説明"
        aria-expanded={open}
      >
        ?
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-30 w-[320px] max-w-[80vw] whitespace-pre-wrap rounded border bg-white px-2 py-1 text-[11px] text-slate-700 shadow"
        >
          {title}
        </div>
      )}
    </span>
  );
};

// ===== 折りたたみヘッダ =====
const AssistHeader: React.FC<{
  title: string;
  enabled: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onDiagnose?: () => void;
  diagnoseLabel?: string;
  rightText?: string;
}> = ({ title, enabled, collapsed, onToggle, rightText, onDiagnose, diagnoseLabel }) => {
  return (
    <div className="sticky top-0 z-10 bg-slate-50 p-2 border-b">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white hover:bg-slate-100 disabled:opacity-60"
            onClick={() => {
              if (!enabled) return;
              onDiagnose?.();
            }}
            disabled={!enabled}
            title="クリックして診断"
          >
            {diagnoseLabel ?? title}
          </button>
          <span className="text-[11px] text-slate-600">{title}</span>
        </div>
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

// ===== ヒントUI（フラット化：省スペース） =====
const HintCard: React.FC<{
  title: string;
  subtitle: string;
  countText?: string;
  stateBadge?: { text: string; tone: "slate" | "emerald" | "amber" | "red" };
  primary: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    disabledReason?: string;
  };
  // secondaryは「救済リンク」に変更（ボタンじゃなくリンク）
  rescue?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
  };
  primaryLeft?: React.ReactNode;
}> = ({ title, subtitle, countText, stateBadge, primary, rescue, primaryLeft }) => {
  const toneBar =
    stateBadge?.tone === "emerald"
      ? "bg-emerald-400"
      : stateBadge?.tone === "amber"
      ? "bg-amber-400"
      : stateBadge?.tone === "red"
      ? "bg-red-400"
      : "bg-slate-300";

  const badgeClass =
    stateBadge?.tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : stateBadge?.tone === "amber"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : stateBadge?.tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <div className="relative">
      {/* 仕切り線（箱ではなく区切り） */}
      <div className="border-b border-slate-200 py-2">
        {/* 左の色バー（省スペースで“状態感”を出す） */}
        <div className="flex items-start gap-2">
          <div className={"w-1.5 rounded-full mt-0.5 " + toneBar} />

          <div className="flex-1 min-w-0">
            {/* 1行目：タイトル＋バッジ＋件数 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-semibold text-[11px] text-slate-800 truncate">
                  {title}
                </div>
                {stateBadge && (
                  <span
                    className={
                      "text-[10px] px-2 py-0.5 rounded border whitespace-nowrap " +
                      badgeClass
                    }
                  >
                    {stateBadge.text}
                  </span>
                )}
              </div>
              {countText && (
                <div className="text-[10px] text-slate-600 whitespace-nowrap">
                  {countText}
                </div>
              )}
            </div>

            {/* 2行目：説明（短めのまま） */}
            <div className="mt-0.5 text-[10px] text-slate-500 leading-snug">
              {subtitle}
            </div>

            {/* 3行目：操作（主ボタン＋救済リンク） */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {primaryLeft && (
                <div className="flex flex-wrap items-center gap-1">{primaryLeft}</div>
              )}
              <div className="relative group">
                <button
                  type="button"
                  className="px-3 py-1 text-[11px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={primary.onClick}
                  disabled={primary.disabled}
                >
                  {primary.label}
                </button>

                {primary.disabled && primary.disabledReason && (
                  <div className="pointer-events-none absolute left-0 top-full mt-1 z-20 w-[320px] rounded border bg-white px-2 py-1 text-[11px] text-slate-700 shadow
                                  opacity-0 translate-y-1 transition
                                  group-hover:opacity-100 group-hover:translate-y-0">
                    {primary.disabledReason}
                  </div>
                )}
              </div>

              {rescue && (
                <button
                  type="button"
                  className="text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={rescue.onClick}
                  disabled={!!rescue.disabled}
                  title={rescue.title}
                >
                  {rescue.label}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


// ===== メイン =====
const ExperimentPage: React.FC = () => {
  const router = useRouter();
  const { objectProblemText, objectAnswerPuml } =
    useProblemConfig();

  // --- オブジェクト／リンクの状態 ---
  const [objects, setObjects] = useState<Obj[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // 「オブジェクト名入力中」のID（入力途中は過剰判定に含まない）
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

  // --- プレビュー（PlantUML） ---
  const [encodedObjectPuml, setEncodedObjectPuml] = useState<string>("");
  const [classPuml, setClassPuml] = useState<string>("");
  const [encodedClassPuml, setEncodedClassPuml] = useState<string>("");
  const [issues, setIssues] = useState<IssuesResponse | null>(null);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);

  // --- プレビュー拡大・縮小 ---
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
  const [objChecked, setObjChecked] = useState(false);
  const [objDiagnoseSnapshot, setObjDiagnoseSnapshot] =
    useState<ObjDiagnoseSnapshot | null>(null);

  // 「正答例と異なるインスタンス名」表示（1回で全件）
  const [objRevealExtra, setObjRevealExtra] = useState(0);
  const [objDirtySinceHint, setObjDirtySinceHint] = useState(false);

  // 「スロット名：正答例と異なる入力」表示
  const [objRevealSlotDiff, setObjRevealSlotDiff] = useState(false);
  const [objSlotDiffDirtySinceHint, setObjSlotDiffDirtySinceHint] =
    useState(false);

  // ===== アシスト状態（リンク） =====
  const [linkChecked, setLinkChecked] = useState(false);
  const [linkDiagnoseSnapshot, setLinkDiagnoseSnapshot] =
    useState<LinkDiagnoseSnapshot | null>(null);
  const [linkRevealExtra, setLinkRevealExtra] = useState(0);
  const [linkDirtySinceHint, setLinkDirtySinceHint] = useState(false);

  // 折りたたみ
  const [objAssistCollapsed, setObjAssistCollapsed] = useState(false);
  const [linkAssistCollapsed, setLinkAssistCollapsed] = useState(false);

  const markMeaningfulChange = (affectObj: boolean, affectLink: boolean) => {
    if (affectObj) {
      setObjDirtySinceHint(true);
      setObjSlotDiffDirtySinceHint(true);
    }
    if (affectLink) setLinkDirtySinceHint(true);
  };

  // スクロール制御
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

  // ===== 無名オブジェクト判定 =====
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

  // ===== 選択オブジェクト/リンク =====
  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );

  const selectedLink = useMemo(
    () => links.find((l) => l.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  );

  const selectedLinkFromName = useMemo(() => {
    if (!selectedLink) return "";
    return objects.find((o) => o.id === selectedLink.from)?.name?.trim() ?? "";
  }, [selectedLink, objects]);

  const selectedLinkToName = useMemo(() => {
    if (!selectedLink) return "";
    return objects.find((o) => o.id === selectedLink.to)?.name?.trim() ?? "";
  }, [selectedLink, objects]);

  // ===== パターン1（オブジェクト不一致）＋スロット（キー）不一致（方針B） =====
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

    // 正答に含まれ、入力にも存在する base について、正答側の必須キーがあるか（件数のみ）
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

    // 入力にのみ含まれるキー（件数のみ）
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

  const objMissingCount = objSnapshot
    ? objSnapshot.missingCount
    : objAssist.missingBases.length;
  const objExtraBasesForReveal = objSnapshot
    ? objSnapshot.extraBases
    : objAssist.extraBases;

  const objSlotRequiredTotal = objSnapshot
    ? objSnapshot.slotRequiredTotal
    : objAssist.requiredSlotKeyTotal;
  const objSlotMissingTotal = objSnapshot
    ? objSnapshot.slotMissingTotal
    : objAssist.missingSlotKeyTotal;
  const objSlotMatchedTotal = objSnapshot
    ? objSnapshot.slotMatchedTotal
    : objAssist.matchedSlotKeyTotal;

  // 入力側基準の表示
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

  const objExtraCount = objSnapshot
    ? objSnapshot.extraCount
    : objAssist.extraBases.length;

  // 「ヒント：正答例と異なるインスタンス名」
  const objExtraRevealAllShown =
    objChecked &&
    objExtraBasesForReveal.length > 0 &&
    objRevealExtra >= objExtraBasesForReveal.length;

  const objExtraPrimaryDisabledReason = useMemo(() => {
    if (!objChecked) return "まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。";
    if (objExtraBasesForReveal.length === 0) return "差分がありません。";
    if (objExtraRevealAllShown) return "表示済みです。";
    if (!objDirtySinceHint) return "診断後に修正すると表示できます。";
    return "";
  }, [
    objChecked,
    objExtraBasesForReveal.length,
    objExtraRevealAllShown,
    objDirtySinceHint,
  ]);

  // 「ヒント：スロット名（正答例と異なる入力）」
  const slotDiffsForShow = objSnapshot?.slotDiffs ?? [];
  const slotDiffHasAny = slotDiffsForShow.length > 0;

  const slotDiffTotalKeys = useMemo(() => {
    let sum = 0;
    for (const d of slotDiffsForShow) sum += d.onlyInInput.length;
    return sum;
  }, [slotDiffsForShow]);

  const objSlotPrimaryDisabledReason = useMemo(() => {
    if (!objChecked) return "まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。";
    if (!slotDiffHasAny) return "差分がありません。";
    if (objRevealSlotDiff) return "表示済みです。";
    if (!objSlotDiffDirtySinceHint) return "診断後に修正すると表示できます。";
    return "";
  }, [objChecked, slotDiffHasAny, objRevealSlotDiff, objSlotDiffDirtySinceHint]);

  // ===== パターン4（リンク不一致） =====
  const linkAssist = useMemo(() => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);

    const requiredLinks = enabled ? extractLinksFromPuml(objectAnswerPuml) : [];
    const requiredEndpointKeys = new Set<string>(
      requiredLinks.map((r) => r.endpointKey)
    );

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

    return {
      enabled,
      requiredEndpointKeys,
      presentEndpointKeys,
      missingPretty,
      extraLinks,
    };
  }, [objectAnswerPuml, objects, links]);

  const linkExtraLinksForReveal = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.extraLinks
    : linkAssist.extraLinks;

  const linkExtraCount = linkExtraLinksForReveal.length;
  const linkMissingCount = linkDiagnoseSnapshot
    ? linkDiagnoseSnapshot.missingCount
    : linkAssist.missingPretty.length;

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

  // ===== オブジェクトアシスト操作 =====
  const handleObjDiagnose = () => {
    setObjChecked(true);

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

    // ★ スロット差分：要望に合わせて「入力にのみ含まれる（正答例と一致しない入力）」だけ収集
    const slotDiffs: { base: string; onlyInInput: string[] }[] = [];

    const bases = Array.from(objAssist.requiredBases).sort((a, b) =>
      a.localeCompare(b, "ja")
    );

    for (const base of bases) {
      if (!objAssist.presentBases.has(base)) continue;

      const req = objAssist.requiredSlotKeysByBase.get(base) ?? new Set<string>();
      const pres = objAssist.presentSlotKeysByBase.get(base) ?? new Set<string>();

      const onlyInInput = Array.from(pres)
        .filter((k) => !req.has(k))
        .sort((a, b) => a.localeCompare(b, "ja"));

      if (onlyInInput.length > 0) {
        slotDiffs.push({ base, onlyInInput });
      }
    }

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
      slotDiffs,
    });

    // 診断し直し = 表示状態リセット
    setObjRevealExtra(0);
    setObjDirtySinceHint(false);

    setObjRevealSlotDiff(false);
    setObjSlotDiffDirtySinceHint(false);
  };

  // 「正答例と異なるインスタンス名」：修正後に表示（通常ルート）
  const handleObjRevealExtraAfterEdit = () => {
    if (!objChecked)
      return alert("まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。");
    if (objExtraBasesForReveal.length === 0) return;
    if (objRevealExtra >= objExtraBasesForReveal.length) return;
    if (!objDirtySinceHint) return;

    setObjAssistCollapsed(false);
    setObjRevealExtra(objExtraBasesForReveal.length);
    setObjDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // 「正答例と異なるインスタンス名」：救済リンク（confirm）
  const handleObjRevealExtraNow = () => {
    if (!objChecked)
      return alert("まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。");
    if (objExtraBasesForReveal.length === 0) return;
    if (objRevealExtra >= objExtraBasesForReveal.length) return;

    const ok = window.confirm(
      "差分を先に表示します。まずは自分で見直したい場合はキャンセルしてください。\n表示しますか？"
    );
    if (!ok) return;

    setObjAssistCollapsed(false);
    setObjRevealExtra(objExtraBasesForReveal.length);
    setObjDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // 「スロット名（正答例と異なる入力）」：修正後に表示（通常ルート）
  const handleObjRevealSlotDiffAfterEdit = () => {
    if (!objChecked)
      return alert("まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。");
    if (!objDiagnoseSnapshot) return;
    if ((objDiagnoseSnapshot.slotDiffs?.length ?? 0) === 0) return;
    if (objRevealSlotDiff) return;
    if (!objSlotDiffDirtySinceHint) return;

    setObjAssistCollapsed(false);
    setObjRevealSlotDiff(true);
    setObjSlotDiffDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // 「スロット名（正答例と異なる入力）」：救済リンク（confirm）
  const handleObjRevealSlotDiffNow = () => {
    if (!objChecked)
      return alert("まず上の「OD作成アシスト（オブジェクト）」をクリックして診断してください。");
    if (!objDiagnoseSnapshot) return;
    if ((objDiagnoseSnapshot.slotDiffs?.length ?? 0) === 0) return;
    if (objRevealSlotDiff) return;

    const ok = window.confirm(
      "差分を先に表示します。まずは自分で見直したい場合はキャンセルしてください。\n表示しますか？"
    );
    if (!ok) return;

    setObjAssistCollapsed(false);
    setObjRevealSlotDiff(true);
    setObjSlotDiffDirtySinceHint(false);
    scrollObjAssistToBottom();
  };

  // ===== リンクアシスト操作 =====
  const handleLinkDiagnose = () => {
    setLinkChecked(true);

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
    const inputTotal = presentLinks.length;
    const inputMatched = presentLinks.filter((p) =>
      linkAssist.requiredEndpointKeys.has(p.endpointKey)
    ).length;
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
    });

    setLinkRevealExtra(0);
    setLinkDirtySinceHint(false);
  };

  // リンク：修正後に差分表示（通常ルート）
  const handleLinkRevealNextExtra = () => {
    if (!linkChecked) return alert("まず上の「OD作成アシスト（リンク）」をクリックして診断してください。");
    if (linkExtraLinksForReveal.length === 0) return;
    if (!linkDirtySinceHint) return;
    if (linkRevealExtra >= linkExtraLinksForReveal.length) return;

    setLinkAssistCollapsed(false);
    setLinkRevealExtra(linkExtraLinksForReveal.length);
    setLinkDirtySinceHint(false);
    scrollLinkAssistToBottom();
  };

  // リンク：救済リンク（confirm）
  const handleLinkRevealNextExtraForce = () => {
    if (!linkChecked) return alert("まず上の「OD作成アシスト（リンク）」をクリックして診断してください。");
    if (linkExtraLinksForReveal.length === 0) return;
    if (linkRevealExtra >= linkExtraLinksForReveal.length) return;

    const ok = window.confirm(
      "差分を先に表示します。まずは自分で見直したい場合はキャンセルしてください。\n表示しますか？"
    );
    if (!ok) return;

    setLinkAssistCollapsed(false);
    setLinkRevealExtra(linkExtraLinksForReveal.length);
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

      setObjRevealSlotDiff(false);
      setObjSlotDiffDirtySinceHint(false);

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

    setObjRevealSlotDiff(false);
    setObjSlotDiffDirtySinceHint(false);

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

  // ===== 進む前の警告（学習者向け） =====
  const buildProceedWarningMessage = () => {
    const enabled = !!(objectAnswerPuml && objectAnswerPuml.trim().length > 0);
    if (!enabled) return { needsConfirm: false, message: "" };

    const parts: string[] = [];
    let strong = false;
    let medium = false;
    let weak = false;

    if (!objChecked) {
      if (objMissingCount > 0 || objExtraCount > 0) weak = true;
    } else {
      if (objExtraCount > 0) strong = true;
      if (objMissingCount > 0) medium = true;
    }

    if (!linkChecked) {
      if (linkMissingCount > 0 || linkExtraCount > 0) weak = true;
    } else {
      if (linkExtraCount > 0) strong = true;
      if (linkMissingCount > 0) medium = true;
    }

    if (!strong && !medium && !weak) return { needsConfirm: false, message: "" };

    const title = strong
      ? "【要確認】このまま進むと、クラス化（抽象化）が崩れる可能性があります。"
      : medium
      ? "【注意】このまま進むと、クラス図に必要な情報が不足する可能性があります。"
      : "【確認】進む前に、いちど診断して確認することもできます。";

    parts.push(title);
    parts.push("");
    parts.push("■ 現在の状態（数のみ）");
    parts.push(
      `・オブジェクト：正答に含まれる ${objInputMatched}/${objInputTotal} ／ 正答にない ${objInputUnmatched}/${objInputTotal} ／ 正答にあるが未入力 ${objMissingCount} ／ 正答例と一致しない候補 ${objExtraCount}`
    );
    parts.push(
      `・リンク：正答に含まれる ${linkInputMatched}/${linkInputTotal} ／ 正答にない ${linkInputUnmatched}/${linkInputTotal} ／ 正答にあるが未入力 ${linkMissingCount} ／ 正答例と一致しない候補 ${linkExtraCount}`
    );
    parts.push("");
    parts.push("このままクラス図編集へ進みますか？");
    return { needsConfirm: true, message: parts.join("\n") };
  };

  // ===== クラス図編集ページへ遷移（警告＋保存） =====
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

    const warn = buildProceedWarningMessage();
    if (warn.needsConfirm) {
      const ok = window.confirm(warn.message);
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
      localStorage.setItem(
        STORAGE_KEY_EDITOR_INITIAL,
        JSON.stringify(editorPayload)
      );
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
  }, [
    objectProblemText,
    selectedObject?.name,
    selectedLinkFromName,
    selectedLinkToName,
  ]);

  // ===== 表示用クラス図PUML =====
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

  // ===== PlantUML サーバURL =====
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

  // ===== ヒントカード用の状態バッジ（統一） =====
  const badgeForExtra = useMemo(() => {
    if (!objChecked) return { text: "未診断", tone: "slate" as const };
    if (objExtraBasesForReveal.length === 0)
      return { text: "差分なし", tone: "emerald" as const };
    if (objExtraRevealAllShown)
      return { text: "表示済み", tone: "emerald" as const };
    if (objDirtySinceHint)
      return { text: "修正検知", tone: "emerald" as const };
    return { text: "編集待ち", tone: "amber" as const };
  }, [objChecked, objExtraBasesForReveal.length, objExtraRevealAllShown, objDirtySinceHint]);

  const badgeForSlot = useMemo(() => {
    if (!objChecked) return { text: "未診断", tone: "slate" as const };
    if (!slotDiffHasAny)
      return { text: "差分なし", tone: "emerald" as const };
    if (objRevealSlotDiff)
      return { text: "表示済み", tone: "emerald" as const };
    if (objSlotDiffDirtySinceHint)
      return { text: "修正検知", tone: "emerald" as const };
    return { text: "編集待ち", tone: "amber" as const };
  }, [objChecked, slotDiffHasAny, objRevealSlotDiff, objSlotDiffDirtySinceHint]);

  const linkExtraAllShown =
    linkChecked &&
    linkExtraLinksForReveal.length > 0 &&
    linkRevealExtra >= linkExtraLinksForReveal.length;

  const badgeForLinkExtra = useMemo(() => {
    if (!linkChecked) return { text: "未診断", tone: "slate" as const };
    if (linkExtraLinksForReveal.length === 0)
      return { text: "差分なし", tone: "emerald" as const };
    if (linkExtraAllShown)
      return { text: "表示済み", tone: "emerald" as const };
    if (linkDirtySinceHint)
      return { text: "修正検知", tone: "emerald" as const };
    return { text: "編集待ち", tone: "amber" as const };
  }, [linkChecked, linkExtraLinksForReveal.length, linkExtraAllShown, linkDirtySinceHint]);

  const linkPrimaryDisabledReason = useMemo(() => {
    if (!linkChecked) return "まず上の「OD作成アシスト（リンク）」をクリックして診断してください。";
    if (linkExtraLinksForReveal.length === 0) return "差分がありません。";
    if (linkExtraAllShown) return "表示済みです。";
    if (!linkDirtySinceHint) return "診断後に修正すると表示できます。";
    return "";
  }, [linkChecked, linkExtraLinksForReveal.length, linkExtraAllShown, linkDirtySinceHint]);

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

        <div
          className={
            "relative group " + (proceedDisabled ? "cursor-not-allowed" : "")
          }
        >
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

            {/* ===== オブジェクトアシスト ===== */}
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
                onDiagnose={handleObjDiagnose}
                diagnoseLabel="オブジェクトを診断する"
                rightText={
                  objAssist.enabled && objChecked
                    ? `正答に含まれる：${objInputMatched}/${objInputTotal}　正答にない：${objInputUnmatched}/${objInputTotal}　正答にあるが未入力：${objMissingCount}　正答例と一致しない候補：${objExtraCount}`
                    : undefined
                }
              />

              {!objAssistCollapsed && objAssist.enabled && (
                <div className="p-2 space-y-2">
                  <div className="text-[10px] text-slate-500">
                      基本は「診断 → 修正 → 差分表示」です（詰まったら下のリンクから差分を先に表示できます）
                    </div>
{/* ★ 見やすいヒントカード 2枚 */}
                  <HintCard
                    title="正答例と異なるインスタンス名（候補）"
                    subtitle="あなたの入力に含まれるインスタンス名のうち、正答例に含まれない可能性があるものを表示します。"
                    countText={
                      objChecked
                        ? `候補：${objExtraBasesForReveal.length}`
                        : undefined
                    }
                    stateBadge={badgeForExtra}
                    primaryLeft={
                      objChecked ? (
                        <>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">一致 {objInputMatched}/{objInputTotal}</span>
                          <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px]">不一致 {objInputUnmatched}/{objInputTotal}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-50 text-slate-700 border border-slate-200 text-[10px]">正答例にあるが未入力 {objMissingCount}</span>
                        </>
                      ) : undefined
                    }
                    primary={{
                      label: "差分を表示",
                      onClick: handleObjRevealExtraAfterEdit,
                      disabled:
                        !objChecked ||
                        objExtraBasesForReveal.length === 0 ||
                        objExtraRevealAllShown ||
                        !objDirtySinceHint,
                      disabledReason: objExtraPrimaryDisabledReason || undefined,
                    }}
                    rescue={{
                      label: "どこが異なるかわからない場合はこちら",
                      onClick: handleObjRevealExtraNow,
                      disabled:
                        !objChecked ||
                        objExtraBasesForReveal.length === 0 ||
                        objExtraRevealAllShown,
                      title: "表示前に確認が出ます（救済ルート）",
                    }}
                  />
                  {objChecked && objRevealExtra > 0 && (
                    <div className="mt-2 ml-3 border-l-2 border-red-200 pl-3 text-[11px]">
                      <div className="font-semibold text-slate-700">
                        正答例と異なるインスタンス名（候補）
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

                  <HintCard
                    title="スロット名（正答例と異なる入力）"
                    subtitle="正答例にも入力にも存在するインスタンス名について、入力にのみ含まれるスロット名を表示します。"
                    countText={
                      objChecked
                        ? `一致しないスロット名：${slotDiffTotalKeys}`
                        : undefined
                    }
                    stateBadge={badgeForSlot}
                    primaryLeft={
                      objChecked ? (
                        <>
                          <span className="px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-[10px]">
                            一致 {objSlotMatchedTotal}/{objSlotRequiredTotal}
                          </span>
                          <span className="px-2 py-0.5 rounded border bg-rose-50 border-rose-200 text-[10px]">
                            不一致 {objSlotMissingTotal}
                          </span>
                          <span className="px-2 py-0.5 rounded border bg-slate-50 border-slate-200 text-[10px]">
                            正答例にあるが未入力 {slotDiffTotalKeys}
                          </span>
                        </>
                      ) : null
                    }
                    primary={{
                      label: "差分を表示",
                      onClick: handleObjRevealSlotDiffAfterEdit,
                      disabled:
                        !objChecked ||
                        !slotDiffHasAny ||
                        objRevealSlotDiff ||
                        !objSlotDiffDirtySinceHint,
                      disabledReason: objSlotPrimaryDisabledReason || undefined,
                    }}
                    rescue={{
                      label: "どこが異なるかわからない場合はこちら",
                      onClick: handleObjRevealSlotDiffNow,
                      disabled: !objChecked || !slotDiffHasAny || objRevealSlotDiff,
                      title: "表示前に確認が出ます（救済ルート）",
                    }}
                  />
                  {objChecked && objDiagnoseSnapshot && objRevealSlotDiff && (
                    <div className="mt-2 ml-3 border-l-2 border-slate-200 pl-3 text-[11px]">
                      <div className="font-semibold text-slate-700">
                        スロット名（正答例と異なる入力）
                      </div>

                      {(objDiagnoseSnapshot.slotDiffs?.length ?? 0) === 0 ? (
                        <div className="mt-1 text-slate-500">
                          一致しないスロット名は見つかりませんでした。
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {objDiagnoseSnapshot.slotDiffs.map((d) => (
                            <div key={d.base} className="rounded border bg-white p-2">
                              <div className="font-semibold text-slate-700">{d.base}</div>

                              <div className="mt-1 flex flex-wrap gap-1">
                                {d.onlyInInput.map((k) => (
                                  <span
                                    key={`${d.base}-${k}`}
                                    className="px-2 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-700"
                                  >
                                    {k}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 text-slate-500">
                        ※ これは「スロット名（キー）」のみの差分です（値は評価しません）。
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
                        setSelectedObjectId((prev) =>
                          prev === o.id ? null : o.id
                        );
                        setSelectedLinkId(null);
                      }}
                    >
                      <span className="truncate">
                        {o.name || "(無名オブジェクト)"}
                      </span>
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
                          インスタンス名
                        </label>
                        <HelpBadge title={TOOLTIP.objectName} />
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-xs"
                        value={selectedObject.name}
                        onChange={(e) =>
                          handleUpdateObjectName(
                            selectedObject.id,
                            e.target.value
                          )
                        }
                        onFocus={() => setEditingObjectId(selectedObject.id)}
                        onBlur={() => setEditingObjectId(null)}
                        placeholder=""
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
                          <HelpBadge
                            title={`${TOOLTIP.slotKey}\n${TOOLTIP.slotValue}`}
                          />
                        </div>

                        <button
                          className="px-2 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200"
                          onClick={handleAddSlotToSelected}
                        >
                          ＋ スロット追加
                        </button>
                      </div>

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
                                placeholder="スロット名"
                                title={TOOLTIP.slotKey}
                              />
                              <span className="text-[11px] text-slate-400">
                                =
                              </span>
                              <input
                                className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                value={s.value}
                                onChange={(e) =>
                                  handleUpdateSlot(idx, {
                                    value: e.target.value,
                                  })
                                }
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
              <span className="font-semibold text-sm">
                オブジェクト図プレビュー（リアルタイム）
              </span>

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
                  <div
                    style={{ zoom: objectZoom }}
                    className="inline-block origin-top-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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

            {/* ===== リンクアシスト ===== */}
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
                onDiagnose={handleLinkDiagnose}
                diagnoseLabel="リンクを診断する"
                rightText={
                  linkAssist.enabled && linkChecked
                    ? `正答に含まれる：${linkInputMatched}/${linkInputTotal}　正答にない：${linkInputUnmatched}/${linkInputTotal}　正答にあるが未入力：${linkMissingCount}　正答例と一致しない候補：${linkExtraCount}`
                    : undefined
                }
              />

              {!linkAssistCollapsed && linkAssist.enabled && (
                <div className="p-2 space-y-2">
                  <div className="text-[10px] text-slate-500">
                      基本は「診断 → 修正 → 差分表示」です（詰まったら下のリンクから差分を先に表示できます）
                    </div>
<HintCard
                    title="正答例と異なるリンク（候補）"
                    subtitle="あなたの入力に含まれるリンクのうち、正答例に含まれない可能性があるものを表示します（端点のみ判定／ラベルは任意）。"
                    countText={
                      linkChecked ? `候補：${linkExtraLinksForReveal.length}` : undefined
                    }
                    stateBadge={badgeForLinkExtra}
                    primaryLeft={
                      linkChecked ? (
                        <>
                          <span className="px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-[10px]">
                            一致 {linkInputMatched}/{linkInputTotal}
                          </span>
                          <span className="px-2 py-0.5 rounded border bg-rose-50 border-rose-200 text-[10px]">
                            不一致 {linkInputUnmatched}/{linkInputTotal}
                          </span>
                          <span className="px-2 py-0.5 rounded border bg-slate-50 border-slate-200 text-[10px]">
                            不足 {linkMissingCount}
                          </span>
                        </>
                      ) : null
                    }
                    primary={{
                      label: "差分を表示",
                      onClick: handleLinkRevealNextExtra,
                      disabled:
                        !linkChecked ||
                        linkExtraLinksForReveal.length === 0 ||
                        linkExtraAllShown ||
                        !linkDirtySinceHint,
                      disabledReason: linkPrimaryDisabledReason || undefined,
                    }}
                    rescue={{
                      label: "どこが異なるかわからない場合はこちら",
                      onClick: handleLinkRevealNextExtraForce,
                      disabled:
                        !linkChecked ||
                        linkExtraLinksForReveal.length === 0 ||
                        linkExtraAllShown,
                      title: "表示前に確認が出ます（救済ルート）",
                    }}
                  />

                  {linkChecked && linkRevealExtra > 0 && (
                    <div className="text-[11px]">
                      <div className="font-semibold text-slate-700">
                        正答例と一致しない可能性（候補：{linkExtraLinksForReveal.length}）
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {linkExtraLinksForReveal
                          .slice(0, linkRevealExtra)
                          .map((p) => (
                            <span
                              key={p.fullKey}
                              className="px-2 py-0.5 rounded border bg-white text-red-700"
                            >
                              {p.pretty}
                            </span>
                          ))}
                      </div>
                      <div className="mt-2 text-slate-500">
                        ※ リンクラベルは任意入力として扱い、診断対象にしません（端点のみ）。
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
                      {l.label && (
                        <div className="text-[10px] text-slate-500">{l.label}</div>
                      )}
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
                          リンク
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
                          リンクラベル
                        </label>
                        <HelpBadge title={TOOLTIP.linkLabel} />
                      </div>

                      <input
                        className="w-full border rounded px-2 py-1 text-[11px]"
                        value={selectedLink.label}
                        onChange={(e) =>
                          handleUpdateLink(selectedLink.id, { label: e.target.value })
                        }
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
                  <span className="font-semibold">インスタンス名が未入力</span>
                  のものがあるため、すべてのオブジェクトに名前を入力してください。
                </div>
              )}

              {!hasUnnamedObject && displayEncodedClassPuml && (
                <div className="flex-1 flex flex-col">
                  {classPreviewUrl && (
                    <div className="flex-1 overflow-auto border-b bg-white p-2">
                      <div
                        style={{ zoom: classZoom }}
                        className="inline-block origin-top-left"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
                      <div className="font-semibold mb-1">
                        推定クラス図のチェック結果
                      </div>
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
                              値が未入力の属性（値が1つも入っていない）:{" "}
                              {c.incomplete.map(explainTypeText).join(", ")}
                            </div>
                          )}
                          {c.contradictory.length > 0 && (
                            <div className="text-red-700">
                              型が混在している属性:{" "}
                              {c.contradictory.map(explainTypeText).join(", ")}
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