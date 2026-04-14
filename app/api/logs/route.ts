import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type IncomingEvent = {
  ts?: string;
  seq?: number;
  session_id?: string;
  problem_id?: string | null;
  user_id?: string | null;
  screen?: string | null;
  event?: string;
  payload?: unknown;
  tz_offset?: number | null;
};

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const events = Array.isArray(body?.events) ? body.events : null;

    if (!events || events.length === 0) {
      return NextResponse.json(
        { ok: false, error: "events is required" },
        { status: 400 }
      );
    }

    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");

    const normalized = events.map((e: IncomingEvent) => ({
      ts: e.ts ?? new Date().toISOString(),
      seq: typeof e.seq === "number" ? e.seq : 0,
      session_id: e.session_id ?? "unknown",
      problem_id: e.problem_id ?? null,
      user_id: e.user_id ?? null,
      screen: e.screen ?? null,
      event: e.event ?? "unknown",
      payload: e.payload ?? {},
      tz_offset: typeof e.tz_offset === "number" ? e.tz_offset : null,
      ip,
      user_agent: userAgent,
    }));

    const { error } = await supabase.from("log_events").insert(normalized);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      saved: normalized.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}