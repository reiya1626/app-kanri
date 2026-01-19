"use client";

import { useState } from "react";
import { Obj } from "@/types";

export function ManualObjectsForm({
  objects,
  setObjects,
}: {
  objects: Obj[];
  setObjects: (next: Obj[]) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");

  const handleAdd = () => {
    if (!name.trim()) return;
    // Obj 型に合わせて { name, type } を追加
    setObjects([
      ...objects, 
      { 
        id: crypto.randomUUID(),
        name, 
        type 
      }
    ]);
    setName("");
    setType("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="オブジェクト名（例: 会員A）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-1 rounded w-1/2"
        />
        <input
          type="text"
          placeholder="型（例: 会員）"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border p-1 rounded w-1/2"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1 bg-blue-500 text-white rounded"
        >
          追加
        </button>
      </div>

      <ul className="text-sm mt-2 list-disc pl-5">
        {objects.map((obj, i) => (
          <li key={i}>
            {obj.name} : {obj.type || "（型なし）"}
          </li>
        ))}
      </ul>
    </div>
  );
}
