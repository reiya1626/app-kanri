"use client";

import { Link as LinkType, Obj } from "@/types";
import { useState } from "react";

export function LinkMiniAdder({
  objects,
  links,
  setLinks,
}: {
  objects: Obj[];
  links: LinkType[];
  setLinks: (next: LinkType[]) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");

  const handleAdd = () => {
    if (!from || !to) return;
    setLinks([...links, { from, to, label }]);
    setFrom("");
    setTo("");
    setLabel("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border p-1 rounded flex-1"
        >
          <option value="">-- from --</option>
          {objects.map((obj, i) => (
            <option key={i} value={obj.name}>
              {obj.name}
            </option>
          ))}
        </select>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border p-1 rounded flex-1"
        >
          <option value="">-- to --</option>
          {objects.map((obj, i) => (
            <option key={i} value={obj.name}>
              {obj.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="ラベル（例: 借りる）"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="border p-1 rounded flex-1"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1 bg-green-500 text-white rounded"
        >
          関係追加
        </button>
      </div>

      <ul className="text-sm mt-2 list-disc pl-5">
        {links.map((l, i) => (
          <li key={i}>
            {l.from} → {l.to} {l.label && `(${l.label})`}
          </li>
        ))}
      </ul>
    </div>
  );
}
