// lib/level1-parse.ts
export type ObjAnn  = { kind: "obj";  instance: string; className?: string; raw: string };
export type SlotAnn = { kind: "slot"; key: string; value: string; ofInstance: string; raw: string };
export type RelAnn  = { kind: "rel";  from: string; to: string; label?: string; raw: string };
export type Ann = ObjAnn | SlotAnn | RelAnn;
export type Tok = { type: "text" | "obj" | "slot" | "rel"; value: string; ann?: Ann };

// 許容キー
const K = {
  OBJ:   new Set(["obj","object","オブジェクト","インスタンス",""]),
  CLASS: new Set(["class","型","クラス"]),
  SLOT:  new Set(["slot","key","スロット","属性"]),
  VALUE: new Set(["value","値"]),
  OF:    new Set(["of","owner","所属","ofInstance"]),
  FROM:  new Set(["from","src","元","起点"]),
  TO:    new Set(["to","dst","先","終点"]),
  LABEL: new Set(["label","ラベル","名称"]),
};

// "a:b|c:d"（全角：と全角｜対応）
function parseBody(body: string): Record<string,string> {
  const parts = body.split(/[|｜]/g).map(p => p.trim()).filter(Boolean);
  const out: Record<string,string> = {};
  for (const p of parts) {
    const i = p.indexOf(":") >= 0 ? p.indexOf(":") : p.indexOf("：");
    if (i < 0) out[""] = (out[""] ?? "").trim() || p.trim();
    else out[p.slice(0,i).trim()] = p.slice(i+1).trim();
  }
  return out;
}

/** {{obj:...}} / ((obj:...)) / （（obj:…））すべて対応。
 *  自然文の「n階」の直後に続く“号室”に slot(階=n) を自動付与。
 */
export function parseLevel1(text: string): { tokens: Tok[] } {
  // 先頭・末尾のデリミタ：{{..}} / ((..)) / （（..））
  const re = /(\{\{|\(\(|（（)\s*(?<kind>obj|slot|rel)\s*[ ：:]\s*(?<body>[\s\S]*?)(\}\}|\)\)|））)/gim;

  const tokens: Tok[] = [];
  let last = 0, m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });

    const raw  = m[0];
    const kind = (m.groups?.kind || "").toLowerCase();
    const b    = parseBody(m.groups?.body || "");

    if (kind === "obj") {
      const instKey  = Object.keys(b).find(k => K.OBJ.has(k))   ?? "";
      const classKey = Object.keys(b).find(k => K.CLASS.has(k));
      const instance = (b[instKey] ?? "").trim();
      const className = (classKey ? b[classKey] : "")?.trim();
      if (!instance) tokens.push({ type: "text", value: raw });
      else tokens.push({ type: "obj", value: instance, ann: { kind: "obj", instance, className: className || undefined, raw } });

    } else if (kind === "slot") {
      const slotKey = Object.keys(b).find(k => K.SLOT.has(k));
      const valKey  = Object.keys(b).find(k => K.VALUE.has(k));
      const ofKey   = Object.keys(b).find(k => K.OF.has(k));
      const key = (slotKey ? b[slotKey] : "").trim();
      const value = (valKey  ? b[valKey]  : "").trim();
      const ofInstance = (ofKey ? b[ofKey] : "").trim();
      if (!key || !ofInstance) tokens.push({ type: "text", value: raw });
      else tokens.push({ type: "slot", value: `${key}=${value}`, ann: { kind: "slot", key, value, ofInstance, raw } });

    } else { // rel
      const free = (b[""] ?? "").trim();
      let from = "", to = "";
      if (free.includes("->")) {
        const [f, t] = free.split("->");
        from = (f ?? "").trim(); to = (t ?? "").trim();
      }
      if (!from || !to) {
        const fromKey = Object.keys(b).find(k => K.FROM.has(k));
        const toKey   = Object.keys(b).find(k => K.TO.has(k));
        from = from || (fromKey ? b[fromKey] : "").trim();
        to   = to   || (toKey   ? b[toKey]   : "").trim();
      }
      const labelKey = Object.keys(b).find(k => K.LABEL.has(k));
      const label = (labelKey ? b[labelKey] : "").trim() || undefined;
      if (!from || !to) tokens.push({ type: "text", value: raw });
      else tokens.push({ type: "rel", value: `${from}->${to}`, ann: { kind: "rel", from, to, label, raw } });
    }

    last = re.lastIndex;
  }

  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return { tokens: injectFloorSlots(tokens) };
}

function isRoomObj(t: Tok): t is Tok & { ann: ObjAnn } {
  return t.type === "obj" && !!t.ann && (t.ann as any).kind === "obj" &&
         ( (t.ann as any).className === "号室" || /号室$/.test((t.ann as any).instance) );
}

// 文中の「n階」を次の“号室”オブジェクトへ自動スロット化
function injectFloorSlots(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "text" && i + 1 < tokens.length && isRoomObj(tokens[i + 1])) {
      const nextRoom = (tokens[i + 1].ann as ObjAnn).instance;
      const re = /(\d{1,3})\s*階/g;
      let last = 0, m: RegExpExecArray | null;
      while ((m = re.exec(t.value))) {
        if (m.index > last) out.push({ type: "text", value: t.value.slice(last, m.index) });
        const floor = m[1];
        out.push({
          type: "slot",
          value: `階=${floor}`,
          ann: { kind: "slot", key: "階", value: floor, ofInstance: nextRoom, raw: `[[auto:${floor}階 of ${nextRoom}]]` }
        });
        last = re.lastIndex;
      }
      if (last < t.value.length) out.push({ type: "text", value: t.value.slice(last) });
      continue;
    }
    out.push(t);
  }
  return out;
}
