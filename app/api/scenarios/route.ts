export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addScenario, listScenarios } from "../../../lib/server/scenarioStore";

export async function GET() {
  return NextResponse.json(listScenarios());
}

export async function POST(req: Request) {
  const body = await req.json();
  const id = `scenario-${Date.now()}`;

  addScenario({
    id,
    classProblemText: body.classProblemText || "",
    objectProblemText: body.objectProblemText || "",
    problemText: body.problemText || "",
    status: body.status ?? "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: body.title || "",
  });

  return NextResponse.json({ id });
}