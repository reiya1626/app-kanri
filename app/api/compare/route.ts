import { NextRequest, NextResponse } from "next/server";
import type {
  CompareRequest, CompareResponse, SnapshotInput, Obj, Edge,
  ClassCluster, RelationSuggestion, MultiplicityHint
} from "@/types";

/** 名前からクラスタ名を推定する簡易ルール
 *  - 末尾の連番/記号をはがす（M1, A, 1203, など）
 *  - 代表トークン（マンション物件/戸建て物件/棟）を優先
 */
function inferClusterName(name: string): string {
  const s = (name ?? "").trim();
  if (s.includes("マンション物件")) return "マンション物件";
  if (s.includes("戸建て物件")) return "戸建て物件";
  if (s.includes("棟")) return "棟";
  // 後ろの英数字や記号を削って“種類名っぽい”部分を返す
  return s.replace(/[A-Za-zＡ-Ｚａ-ｚ0-9０-９]+$/u, "").replace(/[\s_\-]+$/u, "") || s;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CompareRequest;
    const snaps = (body?.snapshots ?? []).filter(Boolean);
    if (snaps.length < 2) {
      return NextResponse.json({ error: "snapshots が2件以上必要です" }, { status: 400 });
    }

    // --- 1) クラスタリング（クラスタ名 → インスタンス名[]）
    const clusterMap = new Map<string, Set<string>>(); // className -> Set(instanceName)
    const inst2cluster = new Map<string, string>();    // instanceName -> className

    for (const s of snaps) {
      for (const o of s.objects as Obj[]) {
        const cn = inferClusterName(o.name);
        if (!clusterMap.has(cn)) clusterMap.set(cn, new Set());
        clusterMap.get(cn)!.add(o.name);
        inst2cluster.set(o.name, cn);
      }
    }
    const clusters: ClassCluster[] = Array.from(clusterMap.entries())
      .map(([className, set]) => ({ className, instances: Array.from(set).sort() }))
      .sort((a,b) => a.className.localeCompare(b.className, "ja"));

    // --- 2) 関係候補（links をクラスタへ持ち上げて集約）
    type RelKey = string; // "from--to"
    const relCount = new Map<RelKey, number>();
    const relLabels = new Map<RelKey, Map<string, number>>(); // labelの頻度

    for (const s of snaps) {
      for (const e of (s.links ?? []) as Edge[]) {
        const fromC = inst2cluster.get(e.from);
        const toC = inst2cluster.get(e.to);
        if (!fromC || !toC) continue;
        const key: RelKey = `${fromC}--${toC}`;
        relCount.set(key, (relCount.get(key) ?? 0) + 1);
        if (e.label && e.label.trim()) {
          const m = relLabels.get(key) ?? new Map<string, number>();
          m.set(e.label, (m.get(e.label) ?? 0) + 1);
          relLabels.set(key, m);
        }
      }
    }

    const relations: RelationSuggestion[] = Array.from(relCount.entries()).map(([k, cnt]) => {
      const [from, to] = k.split("--");
      const labelMap = relLabels.get(k);
      let label: string | undefined;
      if (labelMap) {
        label = Array.from(labelMap.entries()).sort((a,b)=>b[1]-a[1])[0]?.[0];
      }
      return { from, to, label, count: cnt };
    }).sort((a,b) => (b.count - a.count) || a.from.localeCompare(b.from, "ja"));

    // --- 3) 多重度ヒント（各スナップショットで from->to の本数分布）
    const hints: MultiplicityHint[] = [];
    for (const rel of relations) {
      const key = `${rel.from}--${rel.to}`;
      const perSnapshot: MultiplicityHint["perSnapshot"] = [];

      for (const s of snaps) {
        // from クラスタに属するインスタンスの集合
        const fromInstances = (s.objects as Obj[]).map(o => o.name).filter(n => inferClusterName(n) === rel.from);
        const toInstances = (s.objects as Obj[]).map(o => o.name).filter(n => inferClusterName(n) === rel.to);

        // from インスタンスごとに、to へのリンク数を数える
        const countsFromTo: number[] = [];
        for (const fi of fromInstances) {
          const n = (s.links ?? []).filter((e: Edge) => e.from === fi && toInstances.includes(e.to)).length;
          countsFromTo.push(n);
        }

        // 逆方向
        const countsToFrom: number[] = [];
        for (const ti of toInstances) {
          const n = (s.links ?? []).filter((e: Edge) => e.to === ti && fromInstances.includes(e.from)).length;
          countsToFrom.push(n);
        }

        perSnapshot.push({ snapshotId: s.id, fromToCounts: countsFromTo, toFromCounts: countsToFrom });
      }

      hints.push({ key, from: rel.from, to: rel.to, perSnapshot });
    }

    const resp: CompareResponse = {
      suggestions: {
        clusters,
        relations,
        multiplicityHints: hints,
      }
    };
    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
