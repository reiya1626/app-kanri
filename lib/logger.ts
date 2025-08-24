"use client";

import { v4 as uuid } from "uuid";
import type { LogEvent } from "@/types"; // ← types.ts に追加した LogEvent を使う

const SESSION_KEY = "sess_v1";

function getSessionId(): string {
  // SSRガード & localStorage 永続
  if (typeof window === "undefined") return uuid();
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuid();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function createLogger(problemId?: string, userId?: string) {
  const session_id = getSessionId();
  let seq = 0;
  let queue: LogEvent[] = [];

  const log = (event: string, payload?: Record<string, any>) => {
    queue.push({
      ts: new Date().toISOString(),
      seq: ++seq,
      session_id,
      problem_id: problemId,
      user_id: userId,
      event,
      payload,
      tz_offset: new Date().getTimezoneOffset(),
    });
    if (queue.length >= 20) void flush(); // 20件で送信
  };

  const flush = async () => {
    if (!queue.length) return;
    const batch = queue; queue = [];
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true, // 離脱時も送れる
      });
    } catch {
      // 失敗したら戻して次回再送
      queue = [...batch, ...queue];
    }
  };

  // ページ離脱時に送る
  if (typeof window !== "undefined") {
    const onUnload = () => {
      if (!queue.length) return;
      const payload = JSON.stringify({ events: queue });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/logs", new Blob([payload], { type: "application/json" }));
        queue = [];
      }
    };
    window.addEventListener("beforeunload", onUnload);
  }

  return { log, flush, session_id };
}