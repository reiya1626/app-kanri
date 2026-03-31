export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getScenarioById, updateScenario, deleteScenario } from "../../../../lib/server/scenarioStore";

// 型定義: params は Promise<{ id: string }> になります
type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params; // paramsをawaitしてidを取り出す
  
  const s = getScenarioById(id); 
  if (!s) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json(s);
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params; // paramsをawaitしてidを取り出す
  
  const ok = updateScenario(id, await req.json());
  if (!ok) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params; // paramsをawaitしてidを取り出す
  
  const ok = deleteScenario(id);
  if (!ok) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({ ok: true });
}