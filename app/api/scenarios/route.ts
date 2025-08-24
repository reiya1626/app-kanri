export const runtime = "nodejs"; export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listScenarios } from "../scenarioStore";
export async function GET() { return NextResponse.json(listScenarios()); }
