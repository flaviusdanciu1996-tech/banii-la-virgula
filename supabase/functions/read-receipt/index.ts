// Reads a photographed receipt with Gemini and returns structured data. Signed-in users only
// (checked against Supabase Auth, not just the public key). The Gemini key lives in the GEMINI_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Only a real signed-in user (the public anon key alone is not enough). */
async function signedIn(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" } });
    if (!r.ok) return false;
    const u = await r.json();
    return typeof u?.id === "string" && !!u.id;
  } catch { return false; }
}

const PREFERRED = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];
let model: string | null = null;

async function pickModel(key: string): Promise<string> {
  if (model) return model;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
    const j = await r.json();
    const ok = (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace("models/", ""));
    model = PREFERRED.find(p => ok.includes(p))
      ?? ok.find((n: string) => /flash/.test(n) && !/lite|image|tts|audio|live|embedding|thinking/.test(n))
      ?? "gemini-2.5-flash";
  } catch { model = "gemini-2.5-flash"; }
  return model!;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_receipt: { type: "BOOLEAN" },
    merchant: { type: "STRING" },
    date: { type: "STRING", description: "YYYY-MM-DD" },
    total: { type: "NUMBER" },
    currency: { type: "STRING", description: "ISO 4217 code, e.g. EUR, RON, DKK, SEK" },
    items: { type: "ARRAY", items: { type: "OBJECT", properties: {
      name: { type: "STRING" }, name_ro: { type: "STRING" }, amount: { type: "NUMBER" }, category: { type: "STRING" },
    }, required: ["name", "amount", "category"] } },
  },
  required: ["is_receipt", "total", "currency", "items"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await signedIn(req))) return json({ error: "unauthorized" }, 401);
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "missing_key" }, 503);
  let body: { image?: string; mime?: string; categories?: string[] };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body.image || body.image.length > 6_000_000) return json({ error: "bad_image" }, 400);
  const cats = (body.categories ?? []).slice(0, 80);

  const prompt = `You read a photographed shopping receipt (any language: German, Danish, Swedish, Romanian, etc.).
Return: merchant (shop name), date (YYYY-MM-DD), total paid, currency (ISO code), and the purchased items with their final prices (after discounts; ignore deposits/returns lines only if they are refunds).
For every item set name (as printed), name_ro (short Romanian translation) and category: pick EXACTLY one name from this list: ${JSON.stringify(cats)}.
Hints: toilet/WC/sanitär/shower/dusch/douche/toalett/sanifair → "WC & dușuri"; diesel/benzin/fuel/AdBlue → "Combustibil"; coffee, sandwiches, hot food, drinks to go → "Restaurante & cafenele"; groceries → "Mâncare acasă"; tolls/parking/ferry → "Transport".
If the image is not a receipt, set is_receipt=false and leave the rest empty. Numbers use a dot as decimal separator.`;

  const m = await pickModel(key);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: body.mime || "image/jpeg", data: body.image } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 404) model = null;
    return json({ error: r.status === 429 ? "rate_limited" : "ai_error", detail: t.slice(0, 300) }, 502);
  }
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  try { return json({ model: m, ...JSON.parse(text) }); } catch { return json({ error: "unreadable" }, 502); }
});
