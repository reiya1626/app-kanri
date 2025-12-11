// app/experiment/logEvent.ts

// フロントから送る1イベント分の型（サーバ側 route.ts と対応）
export type LogEventPayload = {
  ts: string;            // 発生時刻 (ISO文字列)
  seq: number;           // セッション内の通し番号 (1,2,3,…)
  session_id: string;    // セッションID
  user_id?: string | null;
  problem_id?: string | null;
  screen?: string | null;
  event: string;         // "screen_view" などのイベント名
  payload?: any;         // イベント固有の追加情報
  tz_offset: number;     // 分単位のタイムゾーンオフセット（日本なら 540）
};

// localStorage で使うキー
const SESSION_ID_KEY = "od_training_session_id";
const SEQ_KEY = "od_training_seq";

/**
 * ブラウザ環境かどうかチェック
 * （Next.js のサーバサイドレンダリング中は window がないので早期リターン）
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * セッションIDを取得 or 新規作成
 */
function getOrCreateSessionId(): string {
  if (!isBrowser()) {
    // SSR中に呼ばれた場合はダミーを返す（通常はクライアント側でしか使わない想定）
    return "server-session";
  }

  let id = window.localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    // 乱数でセッションIDを生成
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      id = crypto.randomUUID();
    } else {
      // randomUUID が使えない環境向けの簡易版
      id = "sess-" + Math.random().toString(36).slice(2);
    }
    window.localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

/**
 * セッション内の連番（1,2,3,…）をインクリメントして返す
 */
function nextSequenceNumber(): number {
  if (!isBrowser()) {
    return 0;
  }

  const raw = window.localStorage.getItem(SEQ_KEY);
  const current = raw ? parseInt(raw, 10) || 0 : 0;
  const next = current + 1;
  window.localStorage.setItem(SEQ_KEY, String(next));
  return next;
}

/**
 * 実際に /api/logs にイベントを送る関数
 *
 * 例:
 *   logEvent("screen_view", {}, { screen: "experiment", problemId: "P1" });
 */
export async function logEvent(
  event: string,
  payload: any = {},
  options?: {
    problemId?: string | null;
    screen?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  // SSR中には何もしない
  if (!isBrowser()) return;

  try {
    const now = new Date();

    const ev: LogEventPayload = {
      ts: now.toISOString(),
      seq: nextSequenceNumber(),
      session_id: getOrCreateSessionId(),
      user_id: options?.userId ?? null,
      problem_id: options?.problemId ?? null,
      screen: options?.screen ?? null,
      event,
      payload,
      tz_offset: -now.getTimezoneOffset(), // 日本なら 540
    };

    await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [ev] }),
    });
  } catch (err) {
    // ログ送信失敗で画面が壊れるのは避けたいので握りつぶす
    // console.warn("logEvent failed", err);
  }
}
