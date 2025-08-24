"use client";
import { useState } from "react";
import { Obj, Link as LinkType } from "@/types";

type Props = {
  objects: Obj[];
  setObjects: (v: Obj[]) => void;
  links: LinkType[];
  setLinks: (v: LinkType[]) => void;
};

export function Level3Workbench({ objects, setObjects, links, setLinks }: Props) {
  // --- object 追加 ---
  const [name, setName] = useState("");
  const [type, setType] = useState("");

  function addObject() {
    const n = name.trim();
    if (!n) return;
    setObjects([...objects, { name: n, type: type.trim() }]);
    setName("");
    setType("");
  }

  function removeObject(idx: number) {
    const target = objects[idx]?.name;
    const newObjs = objects.filter((_, i) => i !== idx);
    const newLinks = links.filter(l => l.from !== target && l.to !== target);
    setObjects(newObjs);
    setLinks(newLinks);
  }

  // --- 属性追加（key=value を chips で表示） ---
  const [attrKey, setAttrKey] = useState("");
  const [attrVal, setAttrVal] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);

  function addAttribute() {
    if (selectedIdx < 0) return;
    const k = attrKey.trim();
    const v = attrVal.trim();
    if (!k || !v) return;
    const o = objects[selectedIdx];
    const newName = `${o.name} ・ ${k}=${v}`; // 表示名へ直接付ける簡易版（※必要なら構造化に変更可）
    const newObjs = objects.map((oo, i) => (i === selectedIdx ? { ...oo, name: newName } : oo));
    setObjects(newObjs);
    setAttrKey("");
    setAttrVal("");
  }

  // --- link 追加 ---
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");

  function addLink() {
    if (!from || !to || from === to) return;
    setLinks([...links, { from, to, label: label.trim() }]);
    setFrom("");
    setTo("");
    setLabel("");
  }

  function removeLink(idx: number) {
    setLinks(links.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-6">
      {/* オブジェクト追加 */}
      <div>
        <h3 className="font-semibold mb-2">オブジェクト</h3>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1 w-52" placeholder="名（例: 会員A）"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="border rounded px-2 py-1 w-44" placeholder="型（例: 会員）"
            value={type} onChange={(e) => setType(e.target.value)} />
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={addObject}>追加</button>
        </div>

        {/* 一覧 */}
        <ul className="mt-3 space-y-1">
          {objects.map((o, i) => (
            <li key={i} className={`flex items-center justify-between border rounded px-2 py-1 ${i===selectedIdx?"bg-blue-50":""}`}>
              <div className="text-sm">{o.name} {o.type ? `: ${o.type}` : ""}</div>
              <div className="flex gap-2">
                <button className="text-xs px-2 py-1 border rounded"
                  onClick={() => setSelectedIdx(i)}>{i===selectedIdx?"選択中":"選択"}</button>
                <button className="text-xs px-2 py-1 border rounded"
                  onClick={() => removeObject(i)}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 属性追加（選択中のオブジェクトに付加） */}
      <div>
        <h3 className="font-semibold mb-2">属性（選択中のオブジェクトに key=value を追加）</h3>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1 w-40" placeholder="key（例: 部屋番号）"
            value={attrKey} onChange={(e) => setAttrKey(e.target.value)} />
          <input className="border rounded px-2 py-1 w-40" placeholder="value（例: 502号室）"
            value={attrVal} onChange={(e) => setAttrVal(e.target.value)} />
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={addAttribute}
            disabled={selectedIdx<0}>追加</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">※ 簡易実装：表示名に「・key=value」を追記します。構造化が必要なら型を拡張しましょう。</p>
      </div>

      {/* リンク追加 */}
      <div>
        <h3 className="font-semibold mb-2">リンク</h3>
        <div className="flex gap-2">
          <select className="border rounded px-2 py-1" value={from} onChange={(e)=>setFrom(e.target.value)}>
            <option value="">-- from --</option>
            {objects.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>
          <select className="border rounded px-2 py-1" value={to} onChange={(e)=>setTo(e.target.value)}>
            <option value="">-- to --</option>
            {objects.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>
          <input className="border rounded px-2 py-1 w-40" placeholder="ラベル（例: 借りる）"
            value={label} onChange={(e)=>setLabel(e.target.value)} />
          <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={addLink}>関係追加</button>
        </div>

        {/* リンク一覧 */}
        <ul className="mt-3 space-y-1">
          {links.map((l, i) => (
            <li key={i} className="flex items-center justify-between border rounded px-2 py-1">
              <div className="text-sm">{l.from} → {l.to} {l.label ? `(${l.label})` : ""}</div>
              <button className="text-xs px-2 py-1 border rounded" onClick={()=>removeLink(i)}>削除</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
