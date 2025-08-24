"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCallback } from "react";
import type { WizardInheritance } from "@/types";

export default function InheritanceWizard({
  classNames,
  items,
  onChange,
}: {
  classNames: string[];
  items: WizardInheritance[];
  onChange: (items: WizardInheritance[]) => void;
}) {
  const add = useCallback(() => {
    const first = classNames[0] ?? "";
    const second = classNames[1] ?? classNames[0] ?? "";
    onChange([...(items ?? []), { parent: first, child: second, enabled: true }]);
  }, [classNames, items, onChange]);

  const del = useCallback(
    (idx: number) => onChange(items.filter((_, i) => i !== idx)),
    [items, onChange]
  );

  const patch = useCallback(
    (idx: number, field: "parent" | "child" | "enabled", value: string | boolean) => {
      onChange(
        items.map((it, i) => (i === idx ? { ...it, [field]: value } : it))
      );
    },
    [items, onChange]
  );

  // 簡易候補：親が「物件」なら、末尾が「物件」で親と異なるクラスを子に提案
  const addSuggestion = () => {
    const has = new Set(items.map(i => `${i.child}__${i.parent}`));
    const parent = classNames.find(c => c === "物件");
    if (!parent) return;
    const children = classNames.filter(c => c !== parent && c.endsWith("物件"));
    const next = [
      ...items,
      ...children
        .filter(ch => !has.has(`${ch}__${parent}`))
        .map(ch => ({ parent, child: ch, enabled: true })),
    ];
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>④ 継承（一般化/特化）を決める</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm text-muted-foreground">
          親（上位の抽象）と子（下位の具体）を選んでください。例：<b>物件</b> &lt;-- <b>マンション物件</b>
        </div>

        {(items ?? []).map((it, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={it.enabled}
              onChange={(e) => patch(idx, "enabled", e.target.checked)}
            />
            <span>子</span>
            <select
              className="border rounded px-2 py-1"
              value={it.child}
              onChange={(e) => patch(idx, "child", e.target.value)}
            >
              {classNames.map((n) => (
                <option key={`c-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span> --|&gt; </span>
            <span>親</span>
            <select
              className="border rounded px-2 py-1"
              value={it.parent}
              onChange={(e) => patch(idx, "parent", e.target.value)}
            >
              {classNames.map((n) => (
                <option key={`p-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={() => del(idx)}>
              削除
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Button type="button" onClick={add} disabled={classNames.length < 2}>
            + 行を追加
          </Button>
          <Button type="button" variant="secondary" onClick={addSuggestion}>
            候補を追加（物件ベース）
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
