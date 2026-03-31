
// app/experiment/class-editor/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import plantumlEncoder from "plantuml-encoder";
import { useProblemConfig } from "../../../components/problem-config";

type Obj = {
  id: string;
  name: string;
  slots: { key: string; value: string }[];
};

type Link = {
  id: string;
  from: string;
  to: string;
  label: string;
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

type EditorPayload = {
  initialClassPuml?: string;
  relationHints?: RelationHint[];
  inheritanceCandidates?: InheritanceCandidate[];
  snapshot?: { objects: Obj[]; links: Link[] };
};

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
  kind: "association" | "inheritance";
};

const STORAGE_KEY_EDITOR_INITIAL = "EXPERIMENT_CLASS_EDITOR_INITIAL";
const STORAGE_KEY_EDITOR_STATE = "EXPERIMENT_CLASS_EDITOR_STATE";

const makeId = () => Math.random().toString(36).slice(2);
const esc = (s: string) => String(s ?? "").replace(/"/g, '\\"');

const buildObjectDiagramPuml = (objects: Obj[], links: Link[]) => {
  const lines: string[] = ["@startuml"];
  for (const o of objects) {
    lines.push(`object "${esc(o.name)}" as ${o.id} {`);
    for (const s of o.slots) {
      if (!s.key && !s.value) continue;
      lines.push(`  ${esc(s.key)} = "${esc(s.value)}"`);
    }
    lines.push("}");
  }
  for (const l of links) {
    const from = objects.find((o) => o.id === l.from);
    const to = objects.find((o) => o.id === l.to);
    if (!from || !to) continue;
    const labelPart = l.label ? ` : ${esc(l.label)}` : "";
    lines.push(`${from.id} -- ${to.id}${labelPart}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
};

const parseClassPuml = (puml: string): { classes: ClassInfo[]; relations: Relation[] } => {
  const classes: ClassInfo[] = [];
  const relations: Relation[] = [];
  if (!puml) return { classes, relations };

  const lines = puml.split(/\r?\n/);
  const aliasToId = new Map<string, string>();
  const nameToId = new Map<string, string>();
  let current: ClassInfo | null = null;

  const normalizeRef = (s: string) => s.trim().replace(/^"|"$/g, "");

  const resolveClassId = (ref: string) => {
    const key = normalizeRef(ref);
    return aliasToId.get(key) ?? nameToId.get(key);
  };

  const registerClass = (name: string, alias?: string | null) => {
    const cleanName = name.trim();
    const cls: ClassInfo = { id: makeId(), name: cleanName, attrs: [] };
    classes.push(cls);
    nameToId.set(cleanName, cls.id);
    if (alias?.trim()) aliasToId.set(alias.trim(), cls.id);
    return cls;
  };

  const classQuoted =
    /^class\s+"([^"]+)"(?:\s+as\s+([A-Za-z0-9_]+))?(?:\s+<<[^>]+>>)?(?:\s+#[A-Za-z0-9]+)?\s*\{$/;
  const classBare =
    /^class\s+([^\s{"]+)(?:\s+as\s+([A-Za-z0-9_]+))?(?:\s+<<[^>]+>>)?(?:\s+#[A-Za-z0-9]+)?\s*\{$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("'")) continue;
    if (/^(?:@startuml|@enduml|hide\b|show\b|skinparam\b|title\b|left to right direction\b)/i.test(line)) {
      continue;
    }

    let m = line.match(classQuoted);
    if (m) {
      current = registerClass(m[1], m[2] || null);
      continue;
    }

    m = line.match(classBare);
    if (m) {
      current = registerClass(m[1], m[2] || null);
      continue;
    }

    if (current && line === "}") {
      current = null;
      continue;
    }

    if (current) {
      const attrMatch = line.match(/^(.+?)\s*:\s*(.+)$/);
      if (attrMatch) {
        current.attrs.push({
          id: makeId(),
          name: attrMatch[1].trim(),
          type: attrMatch[2].trim(),
        });
      }
      continue;
    }

    const inheritanceForward =
      line.match(/^("[^"]+"|[^\s"]+)\s+[-.#\[\]A-Za-z0-9]*\|>\s+("[^"]+"|[^\s"]+)\s*$/);
    if (inheritanceForward) {
      const childId = resolveClassId(inheritanceForward[1]);
      const parentId = resolveClassId(inheritanceForward[2]);
      if (childId && parentId) {
        relations.push({
          id: makeId(),
          fromClassId: childId,
          toClassId: parentId,
          label: "",
          leftMultiplicity: "",
          rightMultiplicity: "",
          kind: "inheritance",
        });
      }
      continue;
    }

    const inheritanceBackward =
      line.match(/^("[^"]+"|[^\s"]+)\s+<\|[-.#\[\]A-Za-z0-9]*\s+("[^"]+"|[^\s"]+)\s*$/);
    if (inheritanceBackward) {
      const parentId = resolveClassId(inheritanceBackward[1]);
      const childId = resolveClassId(inheritanceBackward[2]);
      if (childId && parentId) {
        relations.push({
          id: makeId(),
          fromClassId: childId,
          toClassId: parentId,
          label: "",
          leftMultiplicity: "",
          rightMultiplicity: "",
          kind: "inheritance",
        });
      }
      continue;
    }

    const assocWithMultiplicity =
      line.match(/^("[^"]+"|[^\s"]+)\s+"([^"]*)"\s+[-.#\[\]A-Za-z0-9]+\s+"([^"]*)"\s+("[^"]+"|[^\s"]+)(?:\s*:\s*(.+))?$/);
    if (assocWithMultiplicity) {
      const fromId = resolveClassId(assocWithMultiplicity[1]);
      const toId = resolveClassId(assocWithMultiplicity[4]);
      if (fromId && toId) {
        relations.push({
          id: makeId(),
          fromClassId: fromId,
          toClassId: toId,
          label: (assocWithMultiplicity[5] || "").trim(),
          leftMultiplicity: assocWithMultiplicity[2] || "",
          rightMultiplicity: assocWithMultiplicity[3] || "",
          kind: "association",
        });
      }
      continue;
    }

    const simpleAssoc =
      line.match(/^("[^"]+"|[^\s"]+)\s+[-.#\[\]A-Za-z0-9]+\s+("[^"]+"|[^\s"]+)(?:\s*:\s*(.+))?$/);
    if (simpleAssoc) {
      const fromId = resolveClassId(simpleAssoc[1]);
      const toId = resolveClassId(simpleAssoc[2]);
      if (fromId && toId) {
        relations.push({
          id: makeId(),
          fromClassId: fromId,
          toClassId: toId,
          label: (simpleAssoc[3] || "").trim(),
          leftMultiplicity: "",
          rightMultiplicity: "",
          kind: "association",
        });
      }
    }
  }

  return { classes, relations };
};

const buildClassPuml = (
  classes: ClassInfo[],
  relations: Relation[],
) => {
  const lines: string[] = [];
  lines.push("@startuml");
  lines.push("hide empty members");
  lines.push("skinparam classAttributeIconSize 0");

  const aliasById = new Map<string, string>();
  for (const cls of classes) {
    aliasById.set(cls.id, `C_${String(cls.id).replace(/[^A-Za-z0-9_]/g, "_")}`);
  }

  for (const cls of classes) {
    const alias = aliasById.get(cls.id)!;
    lines.push(`class "${esc(cls.name)}" as ${alias} {`);
    for (const a of cls.attrs) {
      lines.push(`  ${esc(a.name)}: ${esc(a.type || "string")}`);
    }
    lines.push("}");
  }

  for (const r of relations) {
    const from = classes.find((c) => c.id === r.fromClassId);
    const to = classes.find((c) => c.id === r.toClassId);
    if (!from || !to) continue;

    const fromAlias = aliasById.get(from.id);
    const toAlias = aliasById.get(to.id);
    if (!fromAlias || !toAlias) continue;

    if (r.kind === "inheritance") {
      lines.push(`${fromAlias} --|> ${toAlias}`);
      continue;
    }

    const leftMult = esc(r.leftMultiplicity || "");
    const rightMult = esc(r.rightMultiplicity || "");
    const labelPart = r.label ? ` : ${esc(r.label)}` : "";
    lines.push(`${fromAlias} "${leftMult}" -- "${rightMult}" ${toAlias}${labelPart}`);
  }

  lines.push("@enduml");
  return lines.join("\n");
};

const relationKey = (r: Relation) =>
  [
    r.kind,
    r.fromClassId,
    r.toClassId,
    r.label || "",
    r.leftMultiplicity || "",
    r.rightMultiplicity || "",
  ].join("||");

const dedupeRelations = (rels: Relation[]) => {
  const seen = new Set<string>();
  const out: Relation[] = [];
  for (const r of rels) {
    const key = relationKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
};

const rewireRelationsToParentOnAdopt = (
  prevRelations: Relation[],
  childIds: string[],
  parentId: string
): Relation[] => {
  const childSet = new Set(childIds);
  const next: Relation[] = [];

  for (const r of prevRelations) {
    if (r.kind === "inheritance") {
      next.push(r);
      continue;
    }

    const fromIsChild = childSet.has(r.fromClassId);
    const toIsChild = childSet.has(r.toClassId);

    if (!fromIsChild && !toIsChild) {
      next.push(r);
      continue;
    }

    if (fromIsChild && toIsChild) {
      continue;
    }

    if (fromIsChild && !toIsChild) {
      next.push({ ...r, id: makeId(), fromClassId: parentId });
      continue;
    }

    if (!fromIsChild && toIsChild) {
      next.push({ ...r, id: makeId(), toClassId: parentId });
      continue;
    }
  }

  return dedupeRelations(next);
};

const RelationHintPanel: React.FC<{
  selectedClass: ClassInfo | null;
  relationHints: RelationHint[];
}> = ({ selectedClass, relationHints }) => {
  const hints = useMemo(() => {
    if (!selectedClass) return [];
    return relationHints.filter(
      (h) => h.fromClass === selectedClass.name || h.toClass === selectedClass.name
    );
  }, [selectedClass, relationHints]);

  if (!selectedClass) {
    return <div className="py-10 text-center text-sm text-slate-400">クラスを選ぶと関連候補が見られます</div>;
  }
  if (hints.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">関連候補はありません</div>;
  }

  return (
    <div className="space-y-3">
      {hints.map((hint, idx) => (
        <div key={`${hint.fromClass}-${hint.toClass}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-800">
            {hint.fromClass} ↔ {hint.toClass}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {hint.candidates.map((c) => (
              <span key={c.label} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                {c.label || "ラベルなし"} ({c.count})
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ClassEditorPage: React.FC = () => {
  const router = useRouter();
  const { objectProblemText } = useProblemConfig();

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationHints, setRelationHints] = useState<RelationHint[]>([]);
  const [inheritanceCandidates, setInheritanceCandidates] = useState<InheritanceCandidate[]>([]);
  const [parentNameDrafts, setParentNameDrafts] = useState<Record<string, string>>({});
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"class" | "relation" | "inheritance">("class");
  const [encodedPuml, setEncodedPuml] = useState("");
  const [classPreviewError, setClassPreviewError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [classZoom, setClassZoom] = useState(1);
  const [odZoom, setOdZoom] = useState(0.8);

  const [odObjects, setOdObjects] = useState<Obj[]>([]);
  const [odLinks, setOdLinks] = useState<Link[]>([]);
  const [showOdEvidence, setShowOdEvidence] = useState(true);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          classes?: ClassInfo[];
          relations?: Relation[];
          selectedClassId?: string | null;
          selectedRelationId?: string | null;
        };
        setClasses(parsed.classes ?? []);
        setRelations(parsed.relations ?? []);
        setSelectedClassId(parsed.selectedClassId ?? null);
        setSelectedRelationId(parsed.selectedRelationId ?? null);
      }

      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_INITIAL);
      if (!raw) return;
      const payload = JSON.parse(raw) as EditorPayload;

      if (!saved && payload.initialClassPuml) {
        const parsed = parseClassPuml(payload.initialClassPuml);
        setClasses(parsed.classes);
        setRelations(parsed.relations);
        setSelectedClassId(parsed.classes[0]?.id ?? null);
      }

      setRelationHints(payload.relationHints ?? []);
      setInheritanceCandidates(payload.inheritanceCandidates ?? []);
      setParentNameDrafts((prev) => {
        const next = { ...prev };
        (payload.inheritanceCandidates ?? []).forEach((cand, idx) => {
          if (!next[cand.key]) next[cand.key] = cand.suggestedParentName ?? `親クラス候補${idx + 1}`;
        });
        return next;
      });

      if (payload.snapshot?.objects && payload.snapshot?.links) {
        setOdObjects(payload.snapshot.objects);
        setOdLinks(payload.snapshot.links);
      }
    } catch {
      // ignore
    }
  }, []);

  const classPumlText = useMemo(
    () => buildClassPuml(classes, relations),
    [classes, relations]
  );

  useEffect(() => {
    try {
      setClassPreviewError(false);
      setEncodedPuml(plantumlEncoder.encode(classPumlText));
    } catch {
      setEncodedPuml("");
      setClassPreviewError(true);
    }
  }, [classPumlText]);

  const previewUrl = useMemo(
    () => (encodedPuml ? `https://www.plantuml.com/plantuml/svg/${encodedPuml}` : ""),
    [encodedPuml]
  );

  const odPuml = useMemo(() => buildObjectDiagramPuml(odObjects, odLinks), [odObjects, odLinks]);
  const odEncoded = useMemo(() => {
    try {
      return odPuml ? plantumlEncoder.encode(odPuml) : "";
    } catch {
      return "";
    }
  }, [odPuml]);
  const odUrl = odEncoded ? `https://www.plantuml.com/plantuml/svg/${odEncoded}` : "";

  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedRelation = relations.find((r) => r.id === selectedRelationId) ?? null;

  const inheritanceStrong = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "strong"),
    [inheritanceCandidates]
  );
  const inheritanceWeak = useMemo(
    () => inheritanceCandidates.filter((c) => c.strength === "weak"),
    [inheritanceCandidates]
  );

  const handleSaveState = () => {
    localStorage.setItem(
      STORAGE_KEY_EDITOR_STATE,
      JSON.stringify({ classes, relations, selectedClassId, selectedRelationId })
    );
    alert("現在のクラス図を保存しました。");
  };

  const handleLoadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EDITOR_STATE);
      if (!raw) return alert("保存データがありません。");
      const parsed = JSON.parse(raw) as {
        classes?: ClassInfo[];
        relations?: Relation[];
        selectedClassId?: string | null;
        selectedRelationId?: string | null;
      };
      setClasses(parsed.classes ?? []);
      setRelations(parsed.relations ?? []);
      setSelectedClassId(parsed.selectedClassId ?? null);
      setSelectedRelationId(parsed.selectedRelationId ?? null);
      alert("保存状態を復元しました。");
    } catch {
      alert("復元に失敗しました。");
    }
  };

  const handleReset = () => {
    if (!window.confirm("編集内容をリセットしますか？")) return;
    localStorage.removeItem(STORAGE_KEY_EDITOR_STATE);
    window.location.reload();
  };

  const handleAddClass = () => {
    const cls: ClassInfo = { id: makeId(), name: `クラス名未定${classes.length + 1}`, attrs: [] };
    setClasses((prev) => [...prev, cls]);
    setSelectedClassId(cls.id);
    setSelectedRelationId(null);
    setActiveTab("class");
  };

  const handleUpdateClass = (id: string, partial: Partial<ClassInfo>) => {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));
  };

  const handleDeleteClass = (id: string) => {
    if (!window.confirm("このクラスを削除しますか？")) return;
    setClasses((prev) => prev.filter((c) => c.id !== id));
    setRelations((prev) => prev.filter((r) => r.fromClassId !== id && r.toClassId !== id));
    if (selectedClassId === id) setSelectedClassId(null);
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
      prev.map((c) =>
        c.id === classId
          ? { ...c, attrs: c.attrs.filter((a) => a.id !== attrId) }
          : c
      )
    );
  };

  const handleAddRelation = () => {
    if (classes.length < 2) return;
    const rel: Relation = {
      id: makeId(),
      fromClassId: classes[0].id,
      toClassId: classes[1].id,
      label: "",
      leftMultiplicity: "0..*",
      rightMultiplicity: "0..*",
      kind: "association",
    };
    setRelations((prev) => [...prev, rel]);
    setSelectedRelationId(rel.id);
    setSelectedClassId(null);
    setActiveTab("relation");
  };

  const handleUpdateRelation = (id: string, partial: Partial<Relation>) => {
    setRelations((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  };

  const handleDeleteRelation = (id: string) => {
    setRelations((prev) => prev.filter((r) => r.id !== id));
    if (selectedRelationId === id) setSelectedRelationId(null);
  };

  const handleApplyInheritanceCandidate = (cand: InheritanceCandidate) => {
    const parentName = (parentNameDrafts[cand.key] ?? "").trim();
    if (!parentName) return alert("親クラス名を入力してください。");

    const childClasses = classes.filter((c) => cand.children.includes(c.name));
    if (childClasses.length !== cand.children.length) {
      return alert("対象の子クラスが見つかりませんでした。");
    }

    const parentId = makeId();
    const parentAttrs: ClassAttr[] = cand.sharedAttrs.map((attrName) => {
      const found = childClasses.flatMap((c) => c.attrs).find((a) => a.name === attrName);
      return {
        id: makeId(),
        name: attrName,
        type: found?.type ?? "string",
      };
    });

    setClasses((prev) => {
      const strippedChildren = prev.map((cls) => {
        if (!cand.children.includes(cls.name)) return cls;
        return {
          ...cls,
          attrs: cls.attrs.filter((a) => !cand.sharedAttrs.includes(a.name)),
        };
      });
      return [...strippedChildren, { id: parentId, name: parentName, attrs: parentAttrs }];
    });

    setRelations((prev) => {
      const childIds = childClasses.map((c) => c.id);
      const rewired = rewireRelationsToParentOnAdopt(prev, childIds, parentId);
      const inheritances: Relation[] = childClasses.map((child) => ({
        id: makeId(),
        fromClassId: child.id,
        toClassId: parentId,
        label: "",
        leftMultiplicity: "",
        rightMultiplicity: "",
        kind: "inheritance",
      }));
      return dedupeRelations([...rewired, ...inheritances]);
    });

    setSelectedClassId(parentId);
    setSelectedRelationId(null);
    setActiveTab("class");
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-2xl font-bold">クラス図編集</h1>
          <p className="mt-1 text-sm text-slate-500">
            自動生成されたクラス図を整えながら、継承候補や多重度の根拠を確認します。
          </p>
        </div>
        <div className="flex gap-3">
          <button className="rounded border border-slate-200 bg-white px-4 py-2" onClick={() => router.back()}>戻る</button>
          <button className="rounded border border-slate-200 bg-white px-4 py-2" onClick={handleLoadState}>復元</button>
          <button className="rounded border border-slate-200 bg-white px-4 py-2" onClick={handleSaveState}>保存</button>
          <button className="rounded border border-rose-200 bg-white px-4 py-2 text-rose-500" onClick={handleReset}>リセット</button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_360px] gap-4 p-3">
        <div className="grid min-h-0 grid-cols-[320px_300px_1fr] gap-4">
          <section className="min-h-0 overflow-hidden rounded border bg-white">
            <div className="border-b px-4 py-3 text-sm font-semibold">要求文（問題）</div>
            <div className="h-full overflow-auto p-4 text-sm leading-8 text-slate-700">
              <div className="whitespace-pre-wrap">{objectProblemText || "問題文がありません。"}</div>
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">クラス一覧</div>
              <button className="rounded border px-3 py-1 text-sm" onClick={handleAddClass}>＋ クラス追加</button>
            </div>
            <div className="h-[calc(100%-57px)] overflow-auto p-4 space-y-3">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedClassId(c.id);
                    setSelectedRelationId(null);
                    setActiveTab("class");
                  }}
                  className={`w-full rounded border p-4 text-left ${
                    selectedClassId === c.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="text-2xl font-bold">{c.name || "クラス名未定"}</div>
                  <div className="mt-1 text-sm text-slate-500">{c.attrs.length} 属性</div>
                </button>
              ))}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded border bg-white">
            <div className="flex border-b px-4">
              <button
                className={`px-4 py-3 text-sm font-semibold ${activeTab === "class" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"}`}
                onClick={() => setActiveTab("class")}
              >
                クラス編集
              </button>
              <button
                className={`px-4 py-3 text-sm font-semibold ${activeTab === "relation" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"}`}
                onClick={() => setActiveTab("relation")}
              >
                関連編集
              </button>
              <button
                className={`px-4 py-3 text-sm font-semibold ${activeTab === "inheritance" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"}`}
                onClick={() => setActiveTab("inheritance")}
              >
                継承候補
              </button>
            </div>

            <div className="h-[calc(100%-57px)] overflow-auto p-4">
              {activeTab === "class" && (
                <>
                  {selectedClass ? (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold">クラス名</label>
                        <input
                          className="w-full rounded border px-4 py-3 text-lg"
                          value={selectedClass.name}
                          onChange={(e) => handleUpdateClass(selectedClass.id, { name: e.target.value })}
                        />
                      </div>
                      <div>
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-sm font-semibold">属性</div>
                          <button className="rounded border px-3 py-1 text-sm" onClick={() => handleAddAttr(selectedClass.id)}>＋ 属性追加</button>
                        </div>
                        <div className="space-y-2">
                          {selectedClass.attrs.map((a) => (
                            <div key={a.id} className="grid grid-cols-[1fr_160px_56px] gap-2">
                              <input
                                className="rounded border px-4 py-3 text-sm"
                                value={a.name}
                                onChange={(e) => handleUpdateAttr(selectedClass.id, a.id, { name: e.target.value })}
                              />
                              <select
                                className="rounded border px-4 py-3 text-sm"
                                value={a.type}
                                onChange={(e) => handleUpdateAttr(selectedClass.id, a.id, { type: e.target.value })}
                              >
                                <option value="string">string</option>
                                <option value="int">int</option>
                                <option value="real">real</option>
                                <option value="boolean">boolean</option>
                              </select>
                              <button className="text-sm text-rose-500" onClick={() => handleDeleteAttr(selectedClass.id, a.id)}>削除</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button className="text-sm text-rose-500" onClick={() => handleDeleteClass(selectedClass.id)}>このクラスを削除</button>
                    </div>
                  ) : (
                    <div className="py-16 text-center text-sm text-slate-400">左からクラスを選択してください</div>
                  )}
                </>
              )}

              {activeTab === "relation" && (
                <div className="grid h-full grid-cols-[300px_1fr] gap-4">
                  <div className="overflow-auto pr-2">
                    <button className="mb-3 w-full rounded border px-3 py-2 text-sm" onClick={handleAddRelation}>＋ 関連追加</button>
                    <div className="space-y-2">
                      {relations
                        .filter((r) => r.kind !== "inheritance")
                        .map((r) => {
                          const from = classes.find((c) => c.id === r.fromClassId)?.name ?? "?";
                          const to = classes.find((c) => c.id === r.toClassId)?.name ?? "?";
                          return (
                            <button
                              key={r.id}
                              className={`w-full rounded border p-3 text-left ${
                                selectedRelationId === r.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"
                              }`}
                              onClick={() => {
                                setSelectedRelationId(r.id);
                                setSelectedClassId(null);
                              }}
                            >
                              <div className="font-semibold">{from} - {to}</div>
                              <div className="mt-1 text-xs text-slate-500">{r.label || "ラベルなし"}</div>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  <div className="overflow-auto">
                    {selectedRelation && selectedRelation.kind !== "inheritance" ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-[1fr_24px_1fr] items-center gap-2">
                          <select
                            className="rounded border px-3 py-2 text-sm"
                            value={selectedRelation.fromClassId}
                            onChange={(e) => handleUpdateRelation(selectedRelation.id, { fromClassId: e.target.value })}
                          >
                            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <div className="text-center text-slate-400">-</div>
                          <select
                            className="rounded border px-3 py-2 text-sm"
                            value={selectedRelation.toClassId}
                            onChange={(e) => handleUpdateRelation(selectedRelation.id, { toClassId: e.target.value })}
                          >
                            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="rounded border px-3 py-2 text-sm"
                            placeholder="左多重度"
                            value={selectedRelation.leftMultiplicity}
                            onChange={(e) => handleUpdateRelation(selectedRelation.id, { leftMultiplicity: e.target.value })}
                          />
                          <input
                            className="rounded border px-3 py-2 text-sm"
                            placeholder="右多重度"
                            value={selectedRelation.rightMultiplicity}
                            onChange={(e) => handleUpdateRelation(selectedRelation.id, { rightMultiplicity: e.target.value })}
                          />
                        </div>

                        <input
                          className="w-full rounded border px-3 py-2 text-sm"
                          placeholder="関連名"
                          value={selectedRelation.label}
                          onChange={(e) => handleUpdateRelation(selectedRelation.id, { label: e.target.value })}
                        />

                        <button className="text-sm text-rose-500" onClick={() => handleDeleteRelation(selectedRelation.id)}>
                          この関連を削除
                        </button>
                      </div>
                    ) : (
                      <RelationHintPanel selectedClass={classes.find((c) => c.id === selectedClassId) ?? null} relationHints={relationHints} />
                    )}
                  </div>
                </div>
              )}

              {activeTab === "inheritance" && (
                <div className="space-y-4">
                  <div className="text-sm font-semibold">継承候補</div>

                  {inheritanceStrong.length === 0 && inheritanceWeak.length === 0 && (
                    <div className="rounded border bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      継承候補はありません。
                    </div>
                  )}

                  {inheritanceStrong.length > 0 && (
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-600">有力候補</div>
                      <div className="space-y-3">
                        {inheritanceStrong.map((cand) => (
                          <div key={cand.key} className="rounded border border-emerald-200 bg-emerald-50 p-4">
                            <div className="text-2xl font-bold">{cand.children.join(" / ")}</div>
                            <div className="mt-2 text-sm text-slate-700">共通属性: {cand.sharedAttrs.join("、")}</div>
                            <div className="mt-2 text-sm text-slate-600">{cand.explanationSummary}</div>
                            <div className="mt-2 text-xs text-slate-500">
                              採用すると、その時点で子クラスの通常関連を親クラスへ付け替えます。
                            </div>
                            {cand.explanationFacts.length > 0 && (
                              <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
                                {cand.explanationFacts.map((f, i) => <li key={i}>{f}</li>)}
                              </ul>
                            )}
                            <div className="mt-3 flex gap-2">
                              <input
                                className="flex-1 rounded border bg-white px-3 py-2 text-sm"
                                value={parentNameDrafts[cand.key] ?? ""}
                                onChange={(e) => setParentNameDrafts((prev) => ({ ...prev, [cand.key]: e.target.value }))}
                              />
                              <button className="rounded border bg-white px-4 py-2 text-sm" onClick={() => handleApplyInheritanceCandidate(cand)}>
                                採用
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {inheritanceWeak.length > 0 && (
                    <details className="rounded border border-slate-200 bg-white">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600">参考候補を表示</summary>
                      <div className="space-y-3 p-4 pt-0">
                        {inheritanceWeak.map((cand) => (
                          <div key={cand.key} className="rounded border border-slate-200 bg-slate-50 p-4">
                            <div className="text-lg font-bold">{cand.children.join(" / ")}</div>
                            <div className="mt-2 text-sm text-slate-700">共通属性: {cand.sharedAttrs.join("、")}</div>
                            <div className="mt-2 text-sm text-slate-600">{cand.explanationSummary}</div>
                            <div className="mt-3 flex gap-2">
                              <input
                                className="flex-1 rounded border bg-white px-3 py-2 text-sm"
                                value={parentNameDrafts[cand.key] ?? ""}
                                onChange={(e) => setParentNameDrafts((prev) => ({ ...prev, [cand.key]: e.target.value }))}
                              />
                              <button className="rounded border bg-white px-4 py-2 text-sm" onClick={() => handleApplyInheritanceCandidate(cand)}>
                                採用
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="min-h-0 overflow-hidden rounded border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold">プレビュー</div>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOdEvidence} onChange={(e) => setShowOdEvidence(e.target.checked)} />
                OD根拠を表示
              </label>
              <div className="flex items-center gap-2">
                <span>OD</span>
                <input type="range" min="0.4" max="2" step="0.1" value={odZoom} onChange={(e) => setOdZoom(parseFloat(e.target.value))} />
              </div>
              <div className="flex items-center gap-2">
                <span>CD</span>
                <input type="range" min="0.4" max="2" step="0.1" value={classZoom} onChange={(e) => setClassZoom(parseFloat(e.target.value))} />
              </div>
            </div>
          </div>

          <div className="grid h-[calc(100%-57px)] grid-cols-2 gap-4 p-4">
            <div className="min-h-0 rounded border bg-slate-50 p-2">
              <div className="mb-2 text-xs font-semibold text-slate-600">オブジェクト図</div>
              <div className="h-[calc(100%-24px)] overflow-auto">
                {isMounted && showOdEvidence && odUrl ? (
                  <div style={{ transform: `scale(${odZoom})`, transformOrigin: "top left", width: "max-content" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={odUrl} alt="OD" />
                  </div>
                ) : (
                  <div className="py-10 text-center text-sm text-slate-400">ODはありません</div>
                )}
              </div>
            </div>

            <div className="min-h-0 rounded border bg-slate-50 p-2">
              <div className="mb-2 text-xs font-semibold text-slate-600">クラス図</div>
              <div className="h-[calc(100%-24px)] overflow-auto">
                {isMounted && previewUrl && !classPreviewError ? (
                  <div style={{ transform: `scale(${classZoom})`, transformOrigin: "top left", width: "max-content" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="CD"
                      onError={() => setClassPreviewError(true)}
                    />
                  </div>
                ) : classPreviewError ? (
                  <div className="space-y-3 p-3">
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      クラス図画像の描画に失敗しました。生成したPlantUMLを下に表示しています。
                    </div>
                    <pre className="overflow-auto rounded border bg-white p-3 text-xs leading-6 text-slate-700">
{classPumlText}
                    </pre>
                  </div>
                ) : (
                  <div className="py-10 text-center text-sm text-slate-400">クラス図がありません</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ClassEditorPage;
