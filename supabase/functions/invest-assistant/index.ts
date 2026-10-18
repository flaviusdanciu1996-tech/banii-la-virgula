// Investment assistant: Gemini explains the user's own numbers (portfolio, BVB Radar, rules, FI goal) that the app sends.
// It is told to use only those numbers. Signed-in users only (verify_jwt). GEMINI_API_KEY stays on the server.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const KEY = Deno.env.get("GEMINI_API_KEY");
const PREFERRED = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];
let models: string[] | null = null;

async function pick(): Promise<string[]> {
  if (models) return models;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${KEY}`);
    const ok: string[] = ((await r.json()).models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace("models/", ""));
    models = PREFERRED.filter(p => ok.includes(p));
    if (!models.length) models = ok.filter(n => /flash/.test(n) && !/lite|image|tts|audio|live|embedding/.test(n)).slice(0, 2);
  } catch { /* below */ }
  if (!models?.length) models = ["gemini-2.5-flash"];
  return models;
}

const SYSTEM = `Ești asistentul de investiții din aplicația personală „Banii la virgulă”, pentru un investitor român pe termen lung care cumpără acțiuni la Bursa de Valori București prin Tradeville.
Primești în CONTEXT (JSON) datele reale: portofoliul lui, Radarul BVB (scor 0–100 = fundamental 40 [dividend, P/E, P/BV, ROE] + tehnic 40 + risc 20, zona, P/E, P/BV, ROE, dividend, RSI, MACD, Bollinger, volum față de normal, beta, medii 50/200, minim/maxim pe un an, volatilitate, căderea maximă, motivele scorului), regulile lui și ținta de independență financiară.

Reguli:
- Folosește DOAR cifrele din CONTEXT. Nu inventa prețuri, rezultate financiare, știri sau evenimente. Dacă îți lipsește o informație, spune clar ce lipsește și de unde ar putea-o lua (ex. rapoartele de pe bvb.ro).
- Analizează pe trei planuri: fundamental (cât de ieftină e față de profit și bilanț, cât de sustenabil e dividendul), tehnic (trend față de mediile 50/200, RSI, unde e în intervalul pe un an), risc (volatilitate, cădere, cât de mult din portofoliu ar însemna).
- Poți spune ce indică Radarul și regulile LUI („după scorul Radar…”, „după regulile tale…”) și poți compara acțiunile între ele. Formulează condiționat și dă ambele părți: argumente pentru, argumente contra, ce ar schimba concluzia.
- Când întreabă „unde pun banii”, poți propune o împărțire între acțiunile cu scor bun din CONTEXT, ținând cont de diversificare (nicio firmă peste ~25–30% din portofoliu) și de ce are deja. Spune de ce.
- Nu promite randamente. Nu folosi termeni ca „sigur”, „garantat”.
- Scrie în română, scurt și clar pentru telefon: titluri mici, liste scurte, cifre concrete. Maxim ~250 de cuvinte dacă nu cere detalii.
- Încheie cu o secțiune „Ce aș urmări” (2–3 puncte) și o singură linie: „Analiză pe datele din aplicație, nu recomandare. Decizia e a ta.”`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return json({ error: "missing_key" }, 503);
  let body: { messages?: { role: string; text: string }[]; context?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const msgs = (body.messages ?? []).slice(-10).filter(m => m && typeof m.text === "string").map(m => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 2000) }] }));
  if (!msgs.length) return json({ error: "bad_request" }, 400);
  const ctx = JSON.stringify(body.context ?? {}).slice(0, 60000);
  const contents = [{ role: "user", parts: [{ text: `CONTEXT:\n${ctx}` }] }, { role: "model", parts: [{ text: "Am datele. Ce vrei să analizăm?" }] }, ...msgs];
  let last = "ai_error";
  for (const m of await pick()) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.4, maxOutputTokens: 1500 } }),
    });
    if (!r.ok) { last = r.status === 429 ? "rate_limited" : "ai_error"; console.log(m, r.status, (await r.text()).slice(0, 200)); continue; }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("").trim();
    if (text) return json({ text, model: m });
  }
  return json({ error: last }, 200);
});
