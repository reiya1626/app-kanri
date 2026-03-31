// components/PromotionWizard.tsx
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { PromoteItem } from "@/types/domain";

export default function PromotionWizard({
  suggestions,
  onApply,
  loading,
  error,
}: {
  suggestions: PromoteItem[];
  onApply: (items: PromoteItem[]) => void; // 適用対象（チェックされたもの）
  loading?: boolean;
  error?: string | null;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const keyOf = (s: PromoteItem) =>
    `${s.parent}::${s.name}::${s.type}::${s.children.sort().join(",")}`;

  const toggle = (k: string) =>
    setChecked((prev) => ({ ...prev, [k]: !prev[k] }));

  const allOn = () => {
    const obj: Record<string, boolean> = {};
    for (const s of suggestions) obj[keyOf(s)] = !s.presentInParent; // 既に親にあるものはデフォルトOFF
    setChecked(obj);
  };
  const allOff = () => setChecked({});

  const apply = () => {
    const items = suggestions.filter((s) => checked[keyOf(s)]);
    onApply(items);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>③.5 属性の昇格（親クラスへ）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          子クラスに重複している属性を、共通の親へ昇格します。既に親にある場合は注意（二重定義）。
        </div>

        {loading && <div className="text-xs text-muted-foreground">候補を解析中...</div>}
        {error && <div className="text-xs text-red-600">候補取得エラー：{error}</div>}

        {!loading && suggestions.length === 0 && (
          <div className="text-xs text-muted-foreground">昇格候補は見つかりませんでした。</div>
        )}

        {suggestions.map((s) => {
          const k = keyOf(s);
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!checked[k]}
                onChange={() => toggle(k)}
                disabled={s.presentInParent} // 親に既にあるなら一旦操作不可に（要件に応じて外してもOK）
                title={s.presentInParent ? "親クラスに既に同名属性があります" : ""}
              />
              <code>{s.name}</code>
              <span>（{s.type}）を</span>
              <b>{s.parent}</b>
              <span>へ昇格（子：</span>
              <span>{s.children.join(", ")}</span>
              <span>）</span>
              {s.requiredAll ? (
                <span className="text-xs text-muted-foreground">（必須：全子で必須）</span>
              ) : (
                <span className="text-xs text-muted-foreground">（必須：子で一部 optional）</span>
              )}
              {s.presentInParent && (
                <span className="text-xs text-amber-700">※ 親に既存</span>
              )}
            </div>
          );
        })}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={allOn} disabled={loading}>
            すべて選択
          </Button>
          <Button type="button" variant="secondary" onClick={allOff} disabled={loading}>
            すべて解除
          </Button>
          <Button type="button" onClick={apply} disabled={loading || suggestions.length === 0}>
            選択を昇格に適用
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
