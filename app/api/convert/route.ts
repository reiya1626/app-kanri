import { NextRequest } from "next/server"
import plantumlEncoder from "plantuml-encoder"

/* ---------------- Utilities ---------------- */
type PrimType = "int" | "real" | "boolean" | "string"
const detectType = (v: string): PrimType => {
  const t = v.trim().replace(/^["']|["']$/g, "")
  if (/^-?\d+$/.test(t))                       return "int"
  if (/^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t))     return "real"
  if (/^(?:true|false)$/i.test(t))             return "boolean"
  return "string"
}
const canonical = (n: string) => (n || "").trim().replace(/\d+$/, "") || n
const normKey = (k: string) => (k || "").trim().toLowerCase().normalize("NFKC").replace(/[_\s]+/g, " ")
const tokenizeList = (v: string) => v.replace(/^\[/, "").replace(/\]$/, "").split(",").map(s => s.trim()).filter(Boolean)
const toStraight = (l: string) => l.replace(/--[->|]/g, "--").replace(/->/g, "-")

/* ---------------- Types ---------------- */
type Attr = { key: string; value: string }
type Obj  = { id?: string; name: string; attrs: Attr[] }
type ManualLink = { from: string; to: string; label?: string; mult?: string }
type ParsedObj = { name: string; base: string; attrs: Attr[]; keyset: Set<string> }
type ClassCandidate = { name: string; objs: ParsedObj[]; keys: Set<string> }

/* ---------------- Parser (object PUML) ---------------- */
const parseObjectPuml = (text: string): Obj[] => {
  const out: Obj[] = []
  const re = /object\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    const body = m[2]
    const attrs: Attr[] = []
    body.split(/\r?\n/).forEach(line => {
      const mm = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/)
      if (mm) attrs.push({ key: mm[1], value: mm[2] })
    })
    out.push({ name, attrs })
  }
  return out
}

/* ---------------- Clustering (v0.1: baseName OR Jaccard≥θ) ---------------- */
const clusterByKeys = (objs: ParsedObj[], theta = 0.7): ClassCandidate[] => {
  const parent = new Map<number, number>()
  const find = (i: number): number => {
    let p = parent.get(i) ?? i
    if (p !== i) { p = find(p); parent.set(i, p) }
    return p
  }
  const union = (i: number, j: number) => {
    const pi = find(i), pj = find(j)
    if (pi !== pj) parent.set(pi, pj)
  }

  for (let i = 0; i < objs.length; i++) parent.set(i, i)

  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i], b = objs[j]
      if (a.base && b.base && a.base === b.base) { union(i, j); continue }
      const A = a.keyset, B = b.keyset
      const inter = new Set([...A].filter(x => B.has(x))).size
      const uni   = new Set([...A, ...B]).size || 1
      const jacc  = inter / uni
      if (jacc >= theta) union(i, j)
    }
  }

  const groups = new Map<number, ParsedObj[]>()
  for (let i = 0; i < objs.length; i++) {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(objs[i])
  }

  const classes: ClassCandidate[] = []
  for (const arr of groups.values()) {
    const cnt = new Map<string, number>()
    arr.forEach(o => cnt.set(o.base, (cnt.get(o.base) || 0) + 1))
    let best = "", bestN = 0
    for (const [k, v] of cnt) if (v > bestN) { best = k; bestN = v }
    const className = (best || arr[0].base || "Class").replace(/(^|[_\s])(\w)/g, (_,$1,$2) => $2.toUpperCase()) || "Class"
    const keys = new Set<string>()
    arr.forEach(o => o.keyset.forEach(k => keys.add(k)))
    classes.push({ name: className, objs: arr, keys })
  }
  return classes
}

/* ---------------- Evidence ---------------- */
type AssocEvidence = {
  from: string; to: string;
  lower: number; upper: number;  // observed per-source degrees
  counts: number[]; uncertain: boolean;
}
type BuildResult = {
  classPuml: string;
  encodedPuml: string;
  evidence: AssocEvidence[];
}

export async function POST(req: NextRequest) {
  const { objectPuml, manualLinks = [] }: { objectPuml: string; manualLinks?: ManualLink[] } = await req.json()

  // 1) parse objects
  const objs0 = parseObjectPuml(objectPuml)
  if (!objs0.length) {
    const empty = "@startuml\n' No objects\n@enduml"
    return Response.json({ classPuml: empty, encodedPuml: plantumlEncoder.encode(empty), evidence: [] })
  }
  const names = new Set(objs0.map(o => o.name))

  // 2) normalize & cluster
  const parsed: ParsedObj[] = objs0.map(o => ({
    name: o.name,
    base: canonical(o.name),
    attrs: o.attrs,
    keyset: new Set(o.attrs.map(a => normKey(a.key))),
  }))
  const classes = clusterByKeys(parsed, 0.7)

  // map object name -> class name
  const obj2class = new Map<string, string>()
  classes.forEach(c => c.objs.forEach(o => obj2class.set(o.name, c.name)))

  // 3) attributes per class（参照は属性から除外）
  const classAttrs = new Map<string, Map<string, Set<PrimType>>>()
  classes.forEach(c => {
    const mp = new Map<string, Set<PrimType>>()
    c.objs.forEach(o => {
      o.attrs.forEach(a => {
        const k = normKey(a.key)
        const set = mp.get(k) || new Set<PrimType>()
        const v = a.value.trim()
        if (v.startsWith("[") && v.endsWith("]")) {
          const arr = tokenizeList(v)
          if (arr.every(x => names.has(x))) { /* reference list → skip */ }
          else set.add(arr.length ? detectType(arr[0]) : "string")
        } else if (names.has(v)) {
          /* single reference → skip */
        } else {
          set.add(detectType(v))
        }
        if (!mp.has(k)) mp.set(k, set)
      })
    })
    classAttrs.set(c.name, mp)
  })

  // 4) reference observations（objects + manual links）
  type EdgeObs = { srcClass: string; dstClass: string; srcName: string; dstNames: string[] }
  const obs: EdgeObs[] = []
  parsed.forEach(o => {
    o.attrs.forEach(a => {
      const v = a.value.trim()
      if (v.startsWith("[") && v.endsWith("]")) {
        const arr = tokenizeList(v).filter(x => names.has(x))
        if (arr.length) obs.push({ srcClass: obj2class.get(o.name)!, dstClass: obj2class.get(arr[0])!, srcName: o.name, dstNames: arr })
      } else if (names.has(v)) {
        obs.push({ srcClass: obj2class.get(o.name)!, dstClass: obj2class.get(v)!, srcName: o.name, dstNames: [v] })
      }
    })
  })
  manualLinks.forEach(l => {
    if (names.has(l.from) && names.has(l.to)) {
      obs.push({ srcClass: obj2class.get(l.from)!, dstClass: obj2class.get(l.to)!, srcName: l.from, dstNames: [l.to] })
    }
  })

  // per-association counts per source instance
  const assocMap = new Map<string, Map<string, number>>() // key "A::B" -> (srcName -> count)
  const keyOf = (a: string, b: string) => `${a}::${b}`
  obs.forEach(o => {
    const key = keyOf(o.srcClass, o.dstClass)
    if (!assocMap.has(key)) assocMap.set(key, new Map())
    const m = assocMap.get(key)!
    m.set(o.srcName, (m.get(o.srcName) || 0) + o.dstNames.length)
  })

  // 5) PlantUML + Evidence
  let classPuml = "@startuml\nset separator none\nhide empty members\n"
  classes.forEach(c => {
    classPuml += `class ${c.name} {\n`
    const mp = classAttrs.get(c.name)!
    Array.from(mp.entries()).forEach(([k, types]) => {
      if (types.size === 0) return
      const t = Array.from(types)[0]
      classPuml += `  ${k}: ${t}\n`
    })
    classPuml += "}\n"
  })

  const evidence: AssocEvidence[] = []
  assocMap.forEach((m, key) => {
    const [a, b] = key.split("::")
    const counts = Array.from(m.values())
    const lower = counts.length ? Math.min(...counts) : 0
    const upper = counts.length ? Math.max(...counts) : 0
    const uncertain = upper <= 1
    evidence.push({ from: a, to: b, lower, upper, counts, uncertain })
    const mult = upper > 1 ? "0..*" : "0..1"
    classPuml += `${a} "1" -- "${mult}" ${b}\n`
  })

  classPuml += "@enduml"
  return Response.json({
    classPuml,
    encodedPuml: plantumlEncoder.encode(classPuml),
    evidence,
  } as BuildResult)
}
