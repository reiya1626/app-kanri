"use client";
import useSWR from "swr";
const fetcher = (u:string)=>fetch(u).then(r=>r.json());

export default function AuthorScenariosPage() {
  const { data, mutate } = useSWR("/api/scenarios", fetcher);

  async function togglePublish(id: string, to: "draft"|"published") {
    await fetch(`/api/scenario/${id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ status: to }) });
    mutate();
  }
  async function regenerate(id: string, classText: string) {
    const r = await fetch("/api/generate-object-problem", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ classProblemText: classText }) });
    const { objectProblemText } = await r.json();
    await fetch(`/api/scenario/${id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ objectProblemText }) });
    mutate();
  }
  async function del(id: string) {
    if (!confirm("この課題を削除しますか？")) return;
    await fetch(`/api/scenario/${id}`, { method:"DELETE" });
    mutate();
  }

  if (!data) return <main className="p-6 text-sm">読み込み中…</main>;

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">課題一覧（教員用）</h1>
      <div className="space-y-3">
        {data.map((s:any)=>(
          <div key={s.id} className="border rounded-lg p-4 bg-white flex items-start justify-between">
            <div className="text-sm">
              <div className="font-medium">ID: {s.id}</div>
              <div className="text-xs text-gray-500">作成: {new Date(s.createdAt).toLocaleString()} / 更新: {new Date(s.updatedAt).toLocaleString()}</div>
              <div className="mt-2">状態: <span className={`px-2 py-0.5 rounded text-xs ${s.status==="published"?"bg-green-100 text-green-700":"bg-gray-100 text-gray-700"}`}>{s.status}</span></div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-600">プレビュー</summary>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <textarea className="w-full h-28 border rounded p-2 text-xs" defaultValue={s.objectProblemText} readOnly />
                  <textarea className="w-full h-28 border rounded p-2 text-xs" defaultValue={s.classProblemText} readOnly />
                </div>
              </details>
            </div>
            <div className="flex flex-col gap-2">
              <a className="px-3 py-1 border rounded text-sm" href={`/attempt/${s.id}`} target="_blank">学生画面を開く</a>
              {s.status==="published" ? (
                <button className="px-3 py-1 border rounded text-sm" onClick={()=>togglePublish(s.id,"draft")}>下書きに戻す</button>
              ) : (
                <button className="px-3 py-1 border rounded text-sm" onClick={()=>togglePublish(s.id,"published")}>公開する</button>
              )}
              <button className="px-3 py-1 border rounded text-sm" onClick={()=>regenerate(s.id, s.classProblemText)}>ステップ1文を再生成</button>
              <button className="px-3 py-1 border rounded text-sm text-red-600" onClick={()=>del(s.id)}>削除</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
