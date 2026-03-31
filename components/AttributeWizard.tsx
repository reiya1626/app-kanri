"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttrSuggestions, WizardClassAttr } from "@/types/domain";

const TYPE_OPTS = ["string", "number", "boolean", "unknown"] as const;

export default function AttributeWizard({
  suggestions,
  value,
  onChange,
}: {
  suggestions: AttrSuggestions;
  value: WizardClassAttr[];
  onChange: (next: WizardClassAttr[]) => void;
}) {
  // 現在値に候補をマージ（候補が増えたときにも表示されるように）
  const current = new Map(value.map(v => [`${v.className}::${v.name}`, v]));
  const rows: WizardClassAttr[] = [];
  for (const cls of suggestions) {
    for (const c of cls.candidates) {
      const key = `${cls.className}::${c.name}`;
      const exist = current.get(key);
      rows.push(
        exist ?? {
          className: cls.className,
          name: c.name,
          type: c.inferredType,
          required: c.requiredByInstances === c.totalInstances && c.totalInstances > 0,
          isId: false,
        }
      );
    }
  }

  const update = (idx: number, patch: Partial<WizardClassAttr>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  return (
    <Card>
      <CardHeader><CardTitle>③ 属性を一般化（クラス属性）</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length === 0 && <div>属性候補が見つかりません。</div>}
        {rows.map((r, i) => (
          <div key={`${r.className}::${r.name}`} className="grid grid-cols-1 md:grid-cols-6 gap-2 border rounded p-2">
            <div className="md:col-span-2">
              <div className="text-xs opacity-70">クラス</div>
              <div className="font-medium">{r.className}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">属性名</div>
              <div className="font-medium">{r.name}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">型</div>
              <select
                className="border rounded px-2 py-1 w-full"
                value={r.type}
                onChange={(e) => update(i, { type: e.target.value as any })}
              >
                {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`req-${i}`}
                type="checkbox"
                checked={r.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              <label htmlFor={`req-${i}`} className="text-xs">必須</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`id-${i}`}
                type="checkbox"
                checked={r.isId}
                onChange={(e) => update(i, { isId: e.target.checked })}
              />
              <label htmlFor={`id-${i}`} className="text-xs">ID</label>
            </div>
          </div>
        ))}
        {rows.length > 0 && (
          <div className="text-xs text-muted-foreground">
            ※ 「必須」は2枚のスナップショットで<strong>全インスタンスに値がある</strong>候補を初期ONにしています。必要に応じて変更してください。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
