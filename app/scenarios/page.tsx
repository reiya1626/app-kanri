"use client";

import Link from "next/link";
import { demoScenarios } from "@/data/demoScenarios";

// 余裕があれば既存のCardなどインポート
// import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";

export default function ScenarioListPage() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">
          演習シナリオを選んでください
        </h1>
        <p className="text-sm text-gray-600">
          課題文を読み、その世界のオブジェクト図を作成し、クラス図へ一般化していきます。
        </p>
      </header>

      <section className="grid gap-4">
        {demoScenarios.map((scenario) => (
          <div
            key={scenario.id}
            className="rounded-xl border p-4 bg-white shadow-sm flex flex-col gap-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{scenario.title}</h2>
                <p className="text-xs text-gray-500">
                  ID: {scenario.id}
                </p>
              </div>

              <Link
                href={`/attempt/${scenario.id}`}
                className="text-sm font-medium rounded-lg border px-3 py-1.5 hover:bg-gray-50"
              >
                このシナリオで始める
              </Link>
            </div>

            <div className="text-sm text-gray-700 whitespace-pre-line line-clamp-4">
              {scenario.problemText.trim()}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
