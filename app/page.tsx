"use client"

import { useState, useMemo } from "react"
import { v4 as uuid } from "uuid"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/* ---------- 型 ---------- */
export type Attr = { key: string; value: string }
export type Obj  = { id: string; name: string; attrs: Attr[] }
export type Link = {
  id   : string
  from : string
  to   : string
  label: string
  mult : string  // "", "\"0..1\"", "\"0..*\"", ...
}

/* ---------- PlantUML (object 部分) ---------- */
const toPuml = (objs: Obj[]) =>
  "@startuml\n" +
  objs
    .map(o =>
      `object ${o.name} {\n` +
      o.attrs
        .filter(a => a.key && a.value)
        .map(a => `  ${a.key} = ${a.value}\n`)
        .join("") +
      "}\n",
    )
    .join("") +
  "@enduml"

/* ---------- 画像 DL ---------- */
const downloadImage = async (url: string, filename: string) => {
  const blob = await (await fetch(url)).blob()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

/* =================================================================== */

export default function Home() {
  /* --- state --- */
  const [objs,  setObjs]  = useState<Obj[]>([])
  const [links, setLinks] = useState<Link[]>([])

  const [classCode, setClassCode] = useState("")
  const [previewUrl, setPreviewUrl] = useState("")
  const [pngUrl, setPngUrl] = useState("")
  const [svgUrl, setSvgUrl] = useState("")
  const [loading, setLoading] = useState(false)

  // ここに追加
  const [evidence, setEvidence] = useState<any[]>([])

  const canonical = (n: string) => (n || "").trim().replace(/\d+$/, "")
  const suggestName = (base: string) => {
    const nums = objs
      .map(o => o.name)
      .filter(n => canonical(n) === base)
      .map(n => parseInt((n.match(/\d+$/)?.[0] || "0"), 10))
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    return `${base}${next}`
  }
  const addCounterexample = (className: string) => {
    const name = suggestName(className)
    setObjs(prev => [...prev, { id: uuid(), name, attrs: [{ key: "", value: "" }] }])
  }


  /* ---------- バリデーション ---------- */
  const { hasError, dupNames, emptyMap, linkErr } = useMemo(() => {
    /* 名前重複・未入力チェック */
    const count = objs.reduce<Record<string, number>>((m, o) => {
      if (!o.name) return m
      m[o.name] = (m[o.name] || 0) + 1
      return m
    }, {})
    const dupNames = new Set(Object.keys(count).filter(n => count[n] > 1))

    const emptyMap: Record<string, { name: boolean; attrs: boolean[] }> = {}
    objs.forEach(o => {
      emptyMap[o.id] = {
        name : !o.name,
        attrs: o.attrs.map(a => !a.key || !a.value),
      }
    })

    /* リンク未選択・自リンク */
    const linkErr: Record<string, boolean> = {}
    links.forEach(l => {
      linkErr[l.id] = !l.from || !l.to || l.from === l.to
    })

    const hasError =
      dupNames.size > 0 ||
      objs.some(o => !o.name || o.attrs.some(a => !a.key || !a.value)) ||
      Object.values(linkErr).some(Boolean)

    return { hasError, dupNames, emptyMap, linkErr }
  }, [objs, links])

  /* ---------- Convert ---------- */
  const convert = async () => {
    if (hasError || objs.length === 0) return
    setLoading(true)
    try {
      const res = await fetch("/api/convert", {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ objectPuml: toPuml(objs), manualLinks: links }),
      })
      const { classPuml, encodedPuml, evidence } = await res.json()
      setClassCode(classPuml)
      setEvidence(evidence || [])
      const base = "https://www.plantuml.com/plantuml"
      setPreviewUrl(`${base}/png/${encodedPuml}`)
      setPngUrl   (`${base}/png/${encodedPuml}`)
      setSvgUrl   (`${base}/svg/${encodedPuml}`)
    } finally {
      setLoading(false)
    }
  }

  /* ======================== UI ======================== */
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-4">
        <h1 className="text-3xl font-bold">Object‑to‑Class Converter</h1>

        {/* ===== バリデーションメッセージ ===== */}
        {hasError && (
          <div className="p-2 bg-red-100 text-red-700 rounded">
            入力に不備があります。赤枠を修正してください。
            {dupNames.size > 0 && (
              <>（重複名: {Array.from(dupNames).join(", ")}）</>
            )}
          </div>
        )}

        {/* ===== レスポンシブ 2 ペイン ===== */}
        <div className="grid lg:grid-cols-5 grid-cols-1 gap-6 h-[calc(100vh-200px)]">
          {/* ---------- 左ペイン : 入力 ---------- */}
          <div className="lg:col-span-2 col-span-1 space-y-4 overflow-y-auto">

            {/* +Add Object */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                setObjs(prev => [
                  ...prev,
                  { id: uuid(), name: "", attrs: [{ key: "", value: "" }] },
                ])
              }
            >
              + Add Object
            </Button>

            {/* +Add Link */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                setLinks(prev => [
                  ...prev,
                  { id: uuid(), from: "", to: "", label: "", mult: "" },
                ])
              }
            >
              + Add Link
            </Button>

            {/* ---- Object Cards ---- */}
            {objs.map(o => (
              <div key={o.id} className="border rounded-lg p-3 space-y-3 bg-white/60">
                <div className="flex gap-2">
                  <input
                    className={`border flex-1 px-2 py-1 rounded ${emptyMap[o.id].name || dupNames.has(o.name) ? "border-red-500" : ""}`}
                    placeholder="Object Name"
                    value={o.name}
                    onChange={e =>
                      setObjs(prev =>
                        prev.map(x =>
                          x.id === o.id ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete object"
                    onClick={() => setObjs(prev => prev.filter(x => x.id !== o.id))}
                  >
                    🗑
                  </Button>
                </div>

                {o.attrs.map((at, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <input
                      className={`border px-2 py-1 rounded ${emptyMap[o.id].attrs[idx] ? "border-red-500" : ""}`}
                      placeholder="attr key"
                      value={at.key}
                      onChange={e =>
                        setObjs(prev =>
                          prev.map(x =>
                            x.id === o.id
                              ? { ...x, attrs: x.attrs.map((a, i) => i === idx ? { ...a, key: e.target.value } : a) }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className={`border px-2 py-1 rounded ${emptyMap[o.id].attrs[idx] ? "border-red-500" : ""}`}
                      placeholder="attr value"
                      value={at.value}
                      onChange={e =>
                        setObjs(prev =>
                          prev.map(x =>
                            x.id === o.id
                              ? { ...x, attrs: x.attrs.map((a, i) => i === idx ? { ...a, value: e.target.value } : a) }
                              : x,
                          ),
                        )
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setObjs(prev =>
                          prev.map(x =>
                            x.id === o.id
                              ? { ...x, attrs: x.attrs.filter((_, i) => i !== idx) }
                              : x,
                          ),
                        )
                      }
                    >
                      ×
                    </Button>
                  </div>
                ))}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setObjs(prev =>
                      prev.map(x =>
                        x.id === o.id
                          ? { ...x, attrs: [...x.attrs, { key: "", value: "" }] }
                          : x,
                      ),
                    )
                  }
                >
                  + Add Attr
                </Button>
              </div>
            ))}

            {/* ---- Links Table ---- */}
            {links.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Links</h3>
                {links.map(l => (
                  <div key={l.id} className="grid grid-cols-[1fr_1fr_1fr_110px_auto] gap-2 items-center">
                    <select
                      className={`border px-1 py-1 rounded ${linkErr[l.id] && (!l.from || l.from === l.to) ? "border-red-500" : ""}`}
                      value={l.from}
                      onChange={e =>
                        setLinks(prev =>
                          prev.map(x =>
                            x.id === l.id ? { ...x, from: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">from</option>
                      {objs.map(o => (
                        <option key={o.id} value={o.name}>{o.name || "(unnamed)"}</option>
                      ))}
                    </select>

                    <select
                      className={`border px-1 py-1 rounded ${linkErr[l.id] && (!l.to || l.from === l.to) ? "border-red-500" : ""}`}
                      value={l.to}
                      onChange={e =>
                        setLinks(prev =>
                          prev.map(x =>
                            x.id === l.id ? { ...x, to: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">to</option>
                      {objs.map(o => (
                        <option key={o.id} value={o.name}>{o.name || "(unnamed)"}</option>
                      ))}
                    </select>

                    <input
                      className="border px-1 py-1 rounded"
                      placeholder="label"
                      value={l.label}
                      onChange={e =>
                        setLinks(prev =>
                          prev.map(x =>
                            x.id === l.id ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                    />

                    <select
                      className="border px-1 py-1 rounded"
                      value={l.mult}
                      onChange={e =>
                        setLinks(prev =>
                          prev.map(x =>
                            x.id === l.id ? { ...x, mult: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value=""> </option>
                      <option value='"0..1"'>"0..1"</option>
                      <option value='"0..*"'>"0..*"</option>
                      <option value='"1..*"'>"1..*"</option>
                      
                    </select>

                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete link"
                      onClick={() => setLinks(prev => prev.filter(x => x.id !== l.id))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* ---- Convert & DL ---- */}
            <Button
              className="w-full"
              onClick={convert}
              disabled={loading || hasError || objs.length === 0}
            >
              {loading ? "Converting..." : "Convert (GUI)"}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!pngUrl} onClick={() => downloadImage(pngUrl, "class.png")}>
                PNG
              </Button>
              <Button variant="secondary" disabled={!svgUrl} onClick={() => downloadImage(svgUrl, "class.svg")}>
                SVG
              </Button>
            </div>
          </div>

          {/* ---------- 右ペイン : Preview / Code ---------- */}
          <div className="lg:col-span-3 col-span-1">
            <Tabs defaultValue="preview" className="h-full">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
              </TabsList>

              <TabsContent value="preview" className="h-full mt-2">
                <Card className="h-full">
                  <CardHeader><CardTitle>Class Diagram Preview</CardTitle></CardHeader>
                  <CardContent className="h-[calc(100%-60px)] flex items-center justify-center">
                    {previewUrl ? (
                      <img src={previewUrl} className="max-w-full max-h-full object-contain" />
                    ) : (
                      <p className="text-muted-foreground">Preview will appear here</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="code" className="h-full mt-2">
                <Card className="h-full">
                  <CardHeader><CardTitle>Generated PlantUML</CardTitle></CardHeader>
                  <CardContent className="h-[calc(100%-60px)]">
                    <Textarea
                      value={classCode}
                      readOnly
                      className="h-full font-mono text-sm bg-muted/50 resize-none"
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="evidence" className="h-full mt-2">
                <Card className="h-full">
                  <CardHeader><CardTitle>Evidence & Suggestions</CardTitle></CardHeader>
                  <CardContent className="space-y-2 overflow-auto max-h-[60vh]">
                    {evidence.length === 0 ? (
                      <p className="text-muted-foreground">No evidence yet. Convert after adding objects/links.</p>
                    ) : (
                      evidence.map((e, idx) => (
                        <div key={idx} className="border rounded p-2 flex items-start justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-medium">{e.from} → {e.to}</div>
                            <div className="text-muted-foreground">
                              observed per-{e.from} counts: [{e.counts?.join(", ") || "-"}] &nbsp;
                              lower={e.lower} upper={e.upper} {e.uncertain ? "(uncertain)" : ""}
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Button variant="outline" size="sm" onClick={() => addCounterexample(e.to)}>
                              + Add {e.to}
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}
