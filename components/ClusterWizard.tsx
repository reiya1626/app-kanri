"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WizardClass } from "@/types";

export default function ClusterWizard({
  items, onChange,
}: { items: WizardClass[]; onChange: (next: WizardClass[]) => void; }) {

  const patch = (i: number, next: Partial<WizardClass>) => {
    const copy = [...items];
    copy[i] = { ...copy[i], ...next };
    onChange(copy);
  };

  return (
    <Card>
      <CardHeader><CardTitle>① クラスタ（クラス候補）を確定</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 && <div>提案がありません。</div>}
        {items.map((c, i) => (
          <div key={c.className} className="border rounded p-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => patch(i, { enabled: e.target.checked })}
              />
              <span className="text-xs opacity-70">採用</span>
              <input
                className="border rounded px-2 py-1 grow"
                value={c.className}
                onChange={(e) => patch(i, { className: e.target.value })}
              />
            </div>
            <div className="text-xs opacity-80">
              例：{c.instances.join("、")}
            </div>
          </div>
        ))}
        {items.length > 0 && (
          <div className="text-xs text-muted-foreground">
            ※ クラス名は自由に編集できます。OFFにすると以降の関係候補からも除外されます。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
