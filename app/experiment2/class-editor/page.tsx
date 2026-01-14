// app/experiment2/class-editor/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
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

// ===== 定数 =====
const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT_CLASS_EDITOR_STATE_V1";
const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";

// 簡易ID生成
const makeId = () => Math.random().toString(36).slice(2);

// 文字列エスケープ
const esc = (s: string) => s.replace(/\"/g, '\\"');

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
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )
    return s;
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
    const label = stripHtmlTags(String(l.label ?? ""))
      .trim()
      .replace(/"/g, '\\"');
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

// ===== フィードバック生成（多重度のヒント中心） =====
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
  const max =
    ra.max === null || rb.max === null ? null : Math.max(ra.max, rb.max);
  return formatMultiplicity({ min, max });
}

// ===== メイン =====
const ClassEditorPage: React.FC = () => {
  const router = useRouter();
  const { classProblemText } = useProblemConfig();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(
    null
  );
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

  // 多重度入力中は，途中の文字（例：0..）でプレビューが不安定になりやすいので，一時的にプレビューを抑制
  const [isMultiplicityEditing, setIsMultiplicityEditing] = useState(false);
  const multEditTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markMultiplicityEditing = () => {
    setIsMultiplicityEditing(true);
    if (multEditTimer.current) clearTimeout(multEditTimer.current);
    multEditTimer.current = setTimeout(
      () => setIsMultiplicityEditing(false),
      600
    );
  };

  useEffect(() => {
    return () => {
      if (multEditTimer.current) clearTimeout(multEditTimer.current);
    };
  }, []);

  // プレビュー抑制：入力が未完了の間は PlantUML エラー表示で混乱しやすいため，表示を遅らせる
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
    // 1) 保存済み状態があればそれを優先
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as {
          classes: ClassInfo[];
          relations: Relation[];
        };
        if (parsed.classes) setClasses(parsed.classes);
        if (parsed.relations) setRelations(parsed.relations);
        return;
      }
    } catch {
      // ignore
    }

    // 2) ODページからの初期payload
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;

      const parsed = JSON.parse(raw) as EditorInitialPayload | EditorPayload;

      const initialClassPuml =
        (parsed as EditorPayload).initialClassPuml ??
        (parsed as EditorInitialPayload).initialClassPuml;

      const { classes: initClasses, relations: initRelations } =
        parseInitialPuml(initialClassPuml);

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
      // ignore
    }
  }, []);

  // ===== PlantUML の再生成 =====
  // ★ ハイライト機能を削除：
  // - 選択中クラス/関連に応じた色変更をしない
  // - 選択中関連だけ赤線にする、をしない（常に通常線）
  useEffect(() => {
    if (classes.length === 0 || previewHoldReasons.length > 0) {
      setEncodedPuml("");
      return;
    }

    const lines: string[] = [];
    lines.push("@startuml");
    lines.push("hide empty members");
    lines.push("skinparam classAttributeIconSize 0");

    // クラス定義：表示名は "..."，内部参照は alias
    const aliasById = new Map<string, string>();
    for (const cls of classes) {
      const safe = String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_");
      aliasById.set(cls.id, `C_${safe}`);
    }

    for (const cls of classes) {
      const alias =
        aliasById.get(cls.id) ??
        `C_${String(cls.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;

      // ★ 色指定（#...）を一切付けない
      lines.push(`class "${esc(cls.name)}" as ${alias} {`);
      for (const a of cls.attrs) {
        const ty = a.type || "string";
        lines.push(`  ${esc(a.name)}: ${ty}`);
      }
      lines.push("}");
    }

    // 関連定義：常に通常線
    for (const r of relations) {
      const from = classes.find((c) => c.id === r.fromClassId);
      const to = classes.find((c) => c.id === r.toClassId);
      if (!from || !to) continue;

      const arrow = "--";

      const leftMult = esc(r.leftMultiplicity || "");
      const rightMult = esc(r.rightMultiplicity || "");
      const labelPart = r.label ? ` : ${esc(r.label)}` : "";

      const fromAlias =
        aliasById.get(from.id) ??
        `C_${String(from.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;
      const toAlias =
        aliasById.get(to.id) ??
        `C_${String(to.id ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`;

      lines.push(
        `${fromAlias} "${leftMult}" ${arrow} "${rightMult}" ${toAlias}${labelPart}`
      );
    }

    lines.push("@enduml");

    try {
      const encoded = plantumlEncoder.encode(lines.join("\n"));
      setEncodedPuml(encoded);
    } catch (e) {
      console.error("encode error", e);
      setEncodedPuml("");
    }
  }, [classes, relations, previewHoldReasons]); // ★ selectedClassId / selectedRelationId を依存から外す

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

  // 選択中要素（編集欄に出すための “選択” は残す）
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

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
    if (!window.confirm("クラス図編集の状態をすべてリセットします．よろしいですか？")) return;

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

  // 多重度候補
  const multiplicityOptions = useMemo(() => {
    const base = ["1", "0..1", "0..*", "1..*"];
    const s = new Set(base);
    for (const r of relations) {
      if (r.leftMultiplicity) s.add(r.leftMultiplicity);
      if (r.rightMultiplicity) s.add(r.rightMultiplicity);
    }
    return Array.from(s.values());
  }, [relations]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* ヘッダ */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white">
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-slate-100 text-sm hover:bg-slate-200"
            onClick={() => router.push("/experiment2")}
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

      {/* メイン：左／右 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左側：問題文 + 編集 */}
        <div className="flex-1 flex flex-col border-r overflow-hidden min-h-0">
          {/* 左上：クラス図作成問題文 */}
          <div className="h-2/5 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b font-semibold text-sm">クラス図作成問題（本文）</div>

            <div className="flex-1 flex min-h-0">
              {/* 左：要求文 */}
              <div className="flex-1 p-3 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap min-w-0">
                {/* ★ ハイライト削除：そのまま表示 */}
                {classProblemText}
              </div>

              {/* 右：遷移前のオブジェクト図（OD） */}
              <div className="w-[360px] max-w-[45%] border-l bg-slate-50 p-2 flex flex-col min-h-0">
                <div className="text-[12px] font-semibold mb-1">オブジェクト図（OD）</div>
                <div className="border rounded bg-white flex-1 p-2 overflow-hidden">
                  {odPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={odPreviewUrl}
                      alt="遷移前のオブジェクト図プレビュー"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[12px] text-slate-500">
                      オブジェクト図（OD）のスナップショットが見つからないため，ここには表示できません．
                    </div>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-600">
                  OD は「具体例」です．多重度や関連名を考えるときの見直し用に表示しています．
                </div>
              </div>
            </div>
          </div>

          {/* 左下：クラス編集＋関連編集 */}
          <div className="flex-1 grid grid-cols-2 bg-slate-50 min-h-0">
            {/* クラスの編集 */}
            <div className="border-r flex flex-col min-h-0">
              <div className="px-3 py-2 border-b flex items-center justify-between bg-white">
                <span className="font-semibold text-sm">クラスの編集</span>
                <button
                  className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  onClick={handleAddClass}
                >
                  ＋ クラスを追加
                </button>
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
                    // ★ ハイライト削除：選択中の色分けはしない（hoverのみ）
                    const isSelected = selectedClassId === c.id;

                    return (
                      <button
                        key={c.id}
                        className="w-full text-left px-2 py-1 border-b flex items-center justify-between transition-colors bg-slate-50 border-slate-200 hover:bg-slate-100"
                        onClick={() => setSelectedClassId(isSelected ? null : c.id)}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-[10px] text-slate-500 ml-1">{c.attrs.length} 属性</span>
                      </button>
                    );
                  })}

                  <datalist id="multiplicity-options">
                    {multiplicityOptions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
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
                        <label className="block text-[11px] font-semibold mb-1">クラス名</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-[12px]"
                          value={selectedClass.name}
                          onChange={(e) => handleUpdateClass(selectedClass.id, { name: e.target.value })}
                          placeholder=""
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

                        <div className="flex flex-col gap-1">
                          {selectedClass.attrs.map((a) => (
                            <div key={a.id} className="border rounded px-2 py-1 bg-slate-50 flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <input
                                  className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                                  value={a.name}
                                  onChange={(e) => handleUpdateAttr(selectedClass.id, a.id, { name: e.target.value })}
                                  placeholder=""
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
                    まだ関連がありません．どのクラス同士が関係しているか，矢印と多重度を追加してみましょう．
                  </div>
                )}

                {relations.map((r) => {
                  // ★ ハイライト削除：選択中の枠色を変えない（hoverのみ）
                  const isSelected = selectedRelationId === r.id;

                  return (
                    <div
                      key={r.id}
                      className="m-2 p-2 border rounded bg-white flex flex-col gap-1 cursor-pointer transition-colors border-slate-200 hover:bg-slate-50"
                      onClick={() => setSelectedRelationId(isSelected ? null : r.id)}
                    >
                      <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <span>端点と多重度</span>
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

                        <input
                          className="border rounded px-1 py-0.5 text-[11px] w-[88px]"
                          value={r.leftMultiplicity}
                          onChange={(e) => {
                            markMultiplicityEditing();
                            handleUpdateRelation(r.id, { leftMultiplicity: e.target.value });
                          }}
                          placeholder=""
                          list="multiplicity-options"
                        />

                        <span className="text-[11px]">→</span>

                        <input
                          className="border rounded px-1 py-0.5 text-[11px] w-[88px]"
                          value={r.rightMultiplicity}
                          onChange={(e) => {
                            markMultiplicityEditing();
                            handleUpdateRelation(r.id, { rightMultiplicity: e.target.value });
                          }}
                          placeholder=""
                          list="multiplicity-options"
                        />

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
                        <span className="text-[11px]">関連名</span>
                        <input
                          className="flex-1 border rounded px-1 py-0.5 text-[11px]"
                          value={r.label}
                          onChange={(e) => handleUpdateRelation(r.id, { label: e.target.value })}
                          placeholder=""
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

        {/* 右側：プレビュー（＋必要なら今後フィードバック追加） */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* 右上：クラス図プレビュー */}
          <div className="h-1/2 border-b bg-white flex flex-col min-h-0">
            <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
              <div className="font-semibold text-sm">クラス図</div>
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
        </div>
      </div>
    </div>
  );
};

export default ClassEditorPage;
