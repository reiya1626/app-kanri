import { NextRequest, NextResponse } from "next/server";
import type {
  AttrSuggestRequest, AttrSuggestResponse, SnapshotInput, Obj
} from "@/types";

function inferType(raw: string): "string" | "number" | "boolean" | "unknown" {
  if (raw === "true" || raw === "false") return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return "number";
  return raw ? "string" : "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AttrSuggestRequest;
    const snaps = (body?.snapshots ?? []).filter(Boolean);
    const clusters = (body?.clusters ?? []).filter(Boolean);
    if (snaps.length < 1 || clusters.length < 1) {
      return NextResponse.json({ error: "snapshots と clusters が必要です" }, { status: 400 });
    }

    // クラスタごとに、そのインスタンスの属性を集計
    const res = clusters.map(({ className, instances }) => {
      const map: Record<string, { seen: number; total: number; types: Record<string, number> }> = {};

      // クラスタの総インスタンス数（S1/S2 合算でユニーク扱い）
      const totalSet = new Set(instances);

      // 各スナップショットで該当インスタンスの属性を集計
      for (const s of snaps) {
        for (const o of (s.objects as Obj[])) {
          if (!totalSet.has(o.name)) continue;
          const attrs = o.attrs || [];
          for (const a of attrs) {
            const key = a.key?.trim();
            const val = (a.value ?? "").toString().trim();
            if (!key) continue;

            if (!map[key]) map[key] = { seen: 0, total: totalSet.size, types: {} };
            if (val !== "") {
              map[key].seen += 1;
              const t = inferType(val);
              map[key].types[t] = (map[key].types[t] ?? 0) + 1;
            }
          }
        }
      }

      // タイプは最多票
      const candidates = Object.entries(map).map(([name, info]) => {
        const [bestType] =
          Object.entries(info.types).sort((a, b) => (b[1] - a[1]))[0] ?? ["unknown", 0];
        return {
          name,
          inferredType: bestType as any,
          requiredByInstances: info.seen,
          totalInstances: info.total,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, "ja"));

      return { className, candidates };
    });

    const resp: AttrSuggestResponse = { suggestions: res };
    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
