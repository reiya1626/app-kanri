export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getScenarioById, updateScenario, deleteScenario } from "../../scenarioStore";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = getScenarioById(params.id); if (!s) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json(s);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ok = updateScenario(params.id, await req.json());
  if (!ok) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = deleteScenario(params.id);
  if (!ok) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({ ok: true });
}
