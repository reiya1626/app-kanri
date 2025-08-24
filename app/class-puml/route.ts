// app/api/class-puml/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { encode } from "plantuml-encoder";

type Attr = { key: string; value: string };
type Obj  = { name: string; type?: string; attrs?: Attr[] };
type Link = { from: string; to: string; label?: string };

function esc(s:any){ return String(s ?? "").replace(/"/g,'\\"'); }
function guessType(v:string){ const s=String(v??"").trim(); if(/^\d+$/.test(s))return "int"; if(/^\d+(\.\d+)?$/.test(s))return "number"; return "string"; }

function buildClassDiagramPuml(snap:{objects:Obj[];links:Link[]}) {
  const objs = Array.isArray(snap.objects)?snap.objects:[];
  const links= Array.isArray(snap.links)?snap.links:[];
  const classOf = new Map<string,string>();
  const classAttrs: Record<string, Map<string,string>> = {};
  const classes = new Set<string>();

  for (const o of objs){
    const cname =
      (o.type && o.type.trim()) ||
      (o.name?.replace(/.*?([一二三四五六七八九十\d]+)?(号室|棟|階|物件)$/, "$2") || "").trim() ||
      `${o.name ?? "Unknown"}型`;
    classOf.set(o.name, cname); classes.add(cname);
    const kvs = Array.isArray(o.attrs)?o.attrs:[];
    if (!classAttrs[cname]) classAttrs[cname] = new Map();
    for (const {key,value} of kvs){
      const k=(key??"").trim(); if(!k) continue;
      if(!classAttrs[cname].has(k)) classAttrs[cname].set(k, guessType(String(value ?? "")));
    }
  }

  type EdgeKey = string;
  const edge: Record<EdgeKey, {fromC:string; toC:string; label?:string; samples:Array<{fromInst:string;toInst:string}>}> = {};
  for (const e of links){
    const fromC = classOf.get(e.from); const toC = classOf.get(e.to);
    if(!fromC || !toC) continue;
    const lab = e.label?.trim() || undefined;
    const key = `${fromC}|${toC}|${lab ?? ""}`;
    edge[key] ??= { fromC, toC, label: lab, samples: [] };
    edge[key].samples.push({ fromInst: e.from, toInst: e.to });
  }

  function mult(samples:Array<{fromInst:string;toInst:string}>){
    const mapF:Record<string,Set<string>>={}, mapT:Record<string,Set<string>>={};
    for(const s of samples){
      (mapF[s.fromInst] ??= new Set()).add(s.toInst);
      (mapT[s.toInst]   ??= new Set()).add(s.fromInst);
    }
    const maxToPerFrom = Math.max(...Object.values(mapF).map(s=>s.size), 0);
    const maxFromPerTo = Math.max(...Object.values(mapT).map(s=>s.size), 0);
    return { left:  maxFromPerTo <= 1 ? "0..1" : "*", right: maxToPerFrom <= 1 ? "0..1" : "*" };
  }

  // ★ データが全く無いときでも PlantUML がエラーにしない最低限の図
  if (classes.size === 0) {
    return `@startuml
title クラス図（データなし）
class "Snapshot" { note = "オブジェクトを追加してください" }
@enduml`;
  }

  const classBlocks = [...classes].map(c=>{
    const lines = classAttrs[c] ? [...classAttrs[c].entries()].map(([k,t])=>`  ${esc(k)} : ${t}`) : [];
    return `class "${esc(c)}" {\n${lines.join("\n")}\n}`;
  }).join("\n\n");

  const rels = Object.values(edge).map(ed=>{
    const m = mult(ed.samples);
    const lab = ed.label ? ` : ${esc(ed.label)}` : "";
    return `"${esc(ed.fromC)}" "${m.right}" -- "${m.left}" "${esc(ed.toC)}"${lab}`;
  }).join("\n");

  return `@startuml
title クラス図（オブジェクト図からの推定）
skinparam linetype ortho
skinparam classAttributeFontSize 12

${classBlocks}

${rels}
@enduml`;
}

export async function POST(req: NextRequest){
  try{
    const body = await req.json().catch(()=>({}));
    const snap = body?.snapshot ?? body;
    const safe = {
      objects: Array.isArray(snap?.objects)? snap.objects : [],
      links:   Array.isArray(snap?.links)?   snap.links   : [],
    };
    const puml = buildClassDiagramPuml(safe);
    const encoded = encode(puml);
    const urlSvg = `https://www.plantuml.com/plantuml/svg/${encoded}`;
    return NextResponse.json({ puml, encoded, urlSvg }, { status:200 });
  }catch(e:any){
    return NextResponse.json({ error: e?.message ?? "bad request" }, { status:400 });
  }
}
