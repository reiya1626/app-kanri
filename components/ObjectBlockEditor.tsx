"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Obj } from "@/types";
import { useCallback } from "react";

type Props = {
  title: string;
  objects: Obj[];
  onChange: (next: Obj[]) => void;
};

const rid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);

export default function ObjectBlockEditor({ title, objects, onChange }: Props) {
  const patchObj = useCallback((id: string, field: "name", value: string) => {
    onChange(objects.map(o => o.id === id ? { ...o, [field]: value } : o));
  }, [objects, onChange]);

  const addObj = useCallback(() => {
    onChange([
      ...objects,
      { id: rid(), name: "", attrs: [] }
    ]);
  }, [objects, onChange]);

  const delObj = useCallback((id: string) => {
    onChange(objects.filter(o => o.id !== id));
  }, [objects, onChange]);

  const addAttr = useCallback((objId: string) => {
    onChange(objects.map(o => {
      if (o.id !== objId) return o;
      const next = { ...(o), attrs: [...(o.attrs || []), { key: "", value: "" }] };
      return next;
    }));
  }, [objects, onChange]);

  const patchAttr = useCallback((objId: string, idx: number, field: "key" | "value", value: string) => {
    onChange(objects.map(o => {
      if (o.id !== objId) return o;
      const attrs = [...(o.attrs || [])];
      attrs[idx] = { ...attrs[idx], [field]: value };
      return { ...o, attrs };
    }));
  }, [objects, onChange]);

  const delAttr = useCallback((objId: string, idx: number) => {
    onChange(objects.map(o => {
      if (o.id !== objId) return o;
      const attrs = [...(o.attrs || [])];
      attrs.splice(idx, 1);
      return { ...o, attrs };
    }));
  }, [objects, onChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {objects.map((o) => (
          <div key={o.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground w-20">名前</label>
              <input
                className="border rounded px-2 py-1 grow"
                value={o.name}
                placeholder='例: マンション物件M1'
                onChange={(e) => patchObj(o.id, "name", e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={() => delObj(o.id)}>オブジェクト削除</Button>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">属性（key / value）</div>
              {(o.attrs ?? []).map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="border rounded px-2 py-1 w-44"
                    placeholder="キー（例: 所在地）"
                    value={a.key}
                    onChange={(e) => patchAttr(o.id, i, "key", e.target.value)}
                  />
                  <input
                    className="border rounded px-2 py-1 grow"
                    placeholder="値（例: 長野市〜）"
                    value={a.value}
                    onChange={(e) => patchAttr(o.id, i, "value", e.target.value)}
                  />
                  <Button type="button" variant="secondary" onClick={() => delAttr(o.id, i)}>削除</Button>
                </div>
              ))}
              <Button type="button" onClick={() => addAttr(o.id)}>+ 属性を追加</Button>
            </div>
          </div>
        ))}

        <Button type="button" onClick={addObj}>+ オブジェクトを追加</Button>
      </CardContent>
    </Card>
  );
}
