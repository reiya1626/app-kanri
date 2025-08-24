// app/api/attr-promote/route.ts
import { NextRequest, NextResponse } from "next/server";
import type {
  AttrPromoteRequest,
  AttrPromoteResponse,
  WizardState,
  WizardInheritance,
  WizardClassAttr,
  PromoteItem,
} from "@/types";

export const dynamic = "force-dynamic";

// ヘルパ：クラス名 → そのクラスに属する属性一覧
function groupAttrsByClass(attrs: WizardClassAttr[] | undefined) {
  const map = new Map<string, WizardClassAttr[]>();
  for (const a of attrs ?? []) {
    if (!map.has(a.className)) map.set(a.className, []);
    map.get(a.className)!.push(a);
  }
  return map;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AttrPromoteRequest;
    const w = body?.wizard as WizardState | undefined;
    if (!w) return NextResponse.json({ error: "wizard が必要です" }, { status: 400 });

    const enabledClassSet = new Set(w.classes.filter(c => c.enabled).map(c => c.className));
    const attrsByClass = groupAttrsByClass(w.classAttrs);

    // 親 → 子 の一覧（enabled のみ）
    const parentToChildren = new Map<string, string[]>();
    for (const inh of (w.inheritances ?? [] as WizardInheritance[])) {
      if (!inh.enabled) continue;
      if (!enabledClassSet.has(inh.parent) || !enabledClassSet.has(inh.child)) continue;
      if (!parentToChildren.has(inh.parent)) parentToChildren.set(inh.parent, []);
      parentToChildren.get(inh.parent)!.push(inh.child);
    }

    const suggestions: PromoteItem[] = [];

    // 各 親 について、子に共通する属性を検出
    for (const [parent, children] of parentToChildren) {
      if (!children || children.length < 2) continue; // 複数子がある場合を優先（単一子でも昇格したいならこの条件を外す）

      // 子ごとの属性マップ name -> {type, requiredCount, totalChildrenHaving}
      const stat: Record<string, { type: WizardClassAttr["type"]; requiredCount: number; holders: string[] }> = {};

      for (const ch of children) {
        const chAttrs = attrsByClass.get(ch) ?? [];
        for (const a of chAttrs) {
          const key = a.name.trim();
          if (!key) continue;
          // 既に登録されていて 型が違うなら共通候補から外す（型不一致）
          if (stat[key] && stat[key].type !== a.type) {
            // 型不一致 → 無効化のため type を "unknown-variance" 的にしてスキップ
            stat[key].type = "unknown";
            continue;
          }
          if (!stat[key]) stat[key] = { type: a.type, requiredCount: 0, holders: [] };
          stat[key].holders.push(ch);
          if (a.required) stat[key].requiredCount += 1;
        }
      }

      // 親が既に持っている属性
      const parentAttrs = new Set((attrsByClass.get(parent) ?? []).map(a => a.name.trim()));

      for (const [name, info] of Object.entries(stat)) {
        const uniqueHolders = Array.from(new Set(info.holders));
        // 2つ以上の子が同名属性を持っていて、型が unknown ではない
        if (uniqueHolders.length >= 2 && info.type !== "unknown") {
          suggestions.push({
            parent,
            name,
            type: info.type,
            children: uniqueHolders,
            requiredAll: info.requiredCount === uniqueHolders.length,
            presentInParent: parentAttrs.has(name),
          });
        }
      }
    }

    const resp: AttrPromoteResponse = { suggestions };
    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
