// components/ClassEditPanel.tsx
"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WizardState, WizardClassAttr } from "@/types/domain";

type Target =
  | { type: "class"; name: string }
  | { type: "rel"; from: string; to: string }
  | null;

export default function ClassEditPanel({
  target,
  wizard,
  onChange,
  onClose,
  onRegenerate,
}: {
  target: Target;
  wizard: WizardState;
  onChange: (w: WizardState) => void;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  if (!target) return null;

  if (target.type === "class") {
    const cls = wizard.classes.find(c => c.className === target.name);
    const attrs = (wizard.classAttrs ?? []).filter(a => a.className === target.name);
    if (!cls) return null;

    const toggle = () => onChange({ ...wizard, classes: wizard.classes.map(c =>
      c.className === cls.className ? { ...c, enabled: !c.enabled } : c
    ) });

    const addAttr = () => {
      const name = prompt("属性名？");
      if (!name) return;
      const next: WizardClassAttr = {
        className: cls.className, name, type: "string", required: false, isId: false,
      };
      onChange({ ...wizard, classAttrs: [ ...(wizard.classAttrs ?? []), next ] });
    };

    const delAttr = (name: string) => {
      onChange({ ...wizard, classAttrs: (wizard.classAttrs ?? []).filter(a =>
        !(a.className === cls.className && a.name === name)
      ) });
    };

    return (
      <Card>
        <CardHeader className="py-2">
          <CardTitle className="text-base">クラス編集：{cls.className}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2 items-center">
            <Button size="sm" onClick={toggle}>{cls.enabled ? "無効化" : "有効化"}</Button>
            <Button size="sm" variant="secondary" onClick={addAttr}>属性を追加</Button>
            <Button size="sm" variant="secondary" onClick={onRegenerate}>再生成</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>閉じる</Button>
          </div>
          <div>
            <div className="font-semibold mt-2">属性</div>
            <ul className="list-disc pl-5">
              {attrs.map(a => (
                <li key={a.name} className="flex items-center gap-2">
                  <span>{a.name} : {a.type}{a.isId ? " (id)" : ""}{a.required ? " (必須)" : ""}</span>
                  <Button size="sm" variant="ghost" onClick={() => delAttr(a.name)}>削除</Button>
                </li>
              ))}
              {attrs.length === 0 && <div className="text-muted-foreground">（なし）</div>}
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  // relation
  const rel = wizard.relations.find(r => r.from === target.from && r.to === target.to);
  if (!rel) return null;

  const set = (patch: Partial<typeof rel>) =>
    onChange({ ...wizard, relations: wizard.relations.map(r =>
      r === rel ? { ...r, ...patch } : r
    ) });

  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle className="text-base">関連編集：{rel.from} — {rel.to}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex gap-2 items-center">
          <Button size="sm" onClick={() => set({ enabled: !rel.enabled })}>
            {rel.enabled ? "無効化" : "有効化"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onRegenerate}>再生成</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">ラベル<input className="border rounded px-2 py-1 w-full"
            value={rel.label ?? ""} onChange={e => set({ label: e.target.value })} /></label>
          <label className="text-xs">役割（from）<input className="border rounded px-2 py-1 w-full"
            value={rel.roleFrom ?? ""} onChange={e => set({ roleFrom: e.target.value })} /></label>
          <label className="text-xs">役割（to）<input className="border rounded px-2 py-1 w-full"
            value={rel.roleTo ?? ""} onChange={e => set({ roleTo: e.target.value })} /></label>
          <label className="text-xs">多重度（from）
            <select className="border rounded px-2 py-1 w-full"
              value={rel.multFrom ?? ""} onChange={e => set({ multFrom: e.target.value })}>
              <option value=""></option><option>1</option><option>0..1</option><option>1..*</option><option>0..*</option>
            </select>
          </label>
          <label className="text-xs">多重度（to）
            <select className="border rounded px-2 py-1 w-full"
              value={rel.multTo ?? ""} onChange={e => set({ multTo: e.target.value })}>
              <option value=""></option><option>1</option><option>0..1</option><option>1..*</option><option>0..*</option>
            </select>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
