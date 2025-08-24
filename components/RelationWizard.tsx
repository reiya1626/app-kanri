"use client";

import { useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WizardRelation, CompareResponse } from "@/types";

type Props = {
  /** 現在の関係（配列） */
  value: WizardRelation[];
  /** 変更時に新しい配列を返す */
  onChange: (next: WizardRelation[]) => void;
  /** あれば、比較ヒント（ラベル頻度など）を使ってラベル初期値の補助にできます */
  compare?: CompareResponse;
};

/** 単一要素を部分的に更新するヘルパ */
function patchAt<T>(arr: T[], idx: number, patch: Partial<T>): T[] {
  return arr.map((it, i) => (i === idx ? { ...it, ...patch } : it));
}

export default function RelationWizard({ value, onChange, compare }: Props) {
  const rels = value ?? [];

  const add = useCallback(() => {
    // ざっくり空のエントリ（必要に応じて初期値を調整）
    const next: WizardRelation = {
      from: "",
      to: "",
      enabled: true,
      label: "",
      roleFrom: "",
      roleTo: "",
      multFrom: "",
      multTo: "",
    };
    onChange([...(rels ?? []), next]);
  }, [rels, onChange]);

  const del = useCallback(
    (idx: number) => {
      const next = [...rels];
      next.splice(idx, 1);
      onChange(next);
    },
    [rels, onChange]
  );

  const patch = useCallback(
    (idx: number, p: Partial<WizardRelation>) => {
      onChange(patchAt(rels, idx, p));
    },
    [rels, onChange]
  );

  // compare からラベル頻度の簡易ヒント（あれば）
  const labelHint = useCallback(
    (from: string, to: string) => {
      if (!compare) return "";
      const hit = compare.suggestions.relations.find(
        (r) => r.from === from && r.to === to
      );
      return hit?.label ?? "";
    },
    [compare]
  );

  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle className="text-base">② 関係と多重度を確定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rels.length === 0 && (
          <div className="text-sm text-muted-foreground">
            関係がありません。「＋関係を追加」で作成してください。
          </div>
        )}

        {rels.map((r, idx) => {
          const hint = labelHint(r.from ?? "", r.to ?? "");
          return (
            <div key={idx} className="border rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled !== false}
                    onChange={(e) => patch(idx, { enabled: e.target.checked })}
                  />
                  採用
                </label>
                <Button size="sm" variant="secondary" onClick={() => del(idx)}>
                  削除
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  placeholder="from（クラス名）"
                  value={r.from ?? ""}
                  onChange={(e) => patch(idx, { from: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder="to（クラス名）"
                  value={r.to ?? ""}
                  onChange={(e) => patch(idx, { to: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder='多重度（from側 例: "1", "0..*"）'
                  value={r.multFrom ?? ""}
                  onChange={(e) => patch(idx, { multFrom: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder='多重度（to側 例: "1", "1..*"）'
                  value={r.multTo ?? ""}
                  onChange={(e) => patch(idx, { multTo: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  placeholder={hint ? `関係名（例: ${hint}）` : "関係名（例: 帰属）"}
                  value={r.label ?? ""}
                  onChange={(e) => patch(idx, { label: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder="役割名（from側）"
                  value={r.roleFrom ?? ""}
                  onChange={(e) => patch(idx, { roleFrom: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder="役割名（to側）"
                  value={r.roleTo ?? ""}
                  onChange={(e) => patch(idx, { roleTo: e.target.value })}
                />
              </div>
            </div>
          );
        })}

        <div>
          <Button type="button" onClick={add}>
            ＋ 関係を追加
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
