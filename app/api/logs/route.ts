// app/api/logs/route.ts
//学習ログをDBに保存
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import crypto from "node:crypto";

export const runtime = "nodejs";          // Edge ではなく Node で動かす
export const dynamic = "force-dynamic";   // キャッシュしない

// 接続プール
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },     // Supabase/Neon などは基本必要
});

// （任意）自由入力の文字列を最小限スクラブ（ハッシュ化）
const LOG_SCRUB = process.env.LOG_SCRUB === "1";
const scrub = (p: any) => {
  if (!LOG_SCRUB || !p || typeof p !== "object") return p ?? null;
  const c = JSON.parse(JSON.stringify(p));
  const hash = (s: any) =>
    typeof s === "string"
      ? crypto.createHash("sha256").update(s).digest("hex").slice(0, 16)
      : s;
  // よく使うフィールドだけ軽くハッシュ（必要に応じて拡張）
  ["prev", "next", "label", "key", "value", "to", "from"].forEach(k => {
    if (k in c) c[k] = hash(c[k]);
  });
  return c;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!events.length) return NextResponse.json({ ok: true, saved: 0 });

    // 送信元情報
    const ua = req.headers.get("user-agent") ?? "";
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      // @ts-ignore
      (req as any).ip ??
      null;

    // まとめて insert（jsonb_to_recordset 経由）
    const client = await pool.connect();
    try {
      const sanitized = events.map((e: any) => ({ ...e, payload: scrub(e.payload) }));
      const sql = `
        insert into log_events
          (ts, seq, session_id, problem_id, user_id, event, payload, tz_offset, ip, user_agent)
        select
          ts, seq, session_id, problem_id, user_id, event, payload, tz_offset, $2::inet, $3
        from jsonb_to_recordset($1::jsonb)
          as x(
            ts timestamptz,
            seq int,
            session_id text,
            problem_id text,
            user_id text,
            event text,
            payload jsonb,
            tz_offset int
          );
      `;
      await client.query(sql, [JSON.stringify(sanitized), ip, ua]);
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, saved: events.length });
  } catch (err: any) {
    console.error("[/api/logs] DB error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
