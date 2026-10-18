// BVB Radar data: daily prices (Yahoo Finance, 6 years, adjusted) + fundamentals from bvb.ro (P/E, P/BV, dividend yield).
// Runs on weekdays after the close (pg_cron) and on demand from the app. Then sends alerts when a stock you own
// or follow changes zone (for example into "Zonă de cumpărare").
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fromYahoo, parseBvbIndicators, score, LABELS, type StockData, type Label } from "./radar.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36", "Accept-Language": "ro-RO,ro;q=0.9" };
const todayRo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// BET index companies and other liquid names on BVB.
const UNIVERSE = ["TLV", "SNP", "H2O", "SNG", "BRD", "SNN", "TGN", "EL", "DIGI", "M", "ONE", "TEL", "TRP", "WINE", "AQ", "TTS", "FP", "BVB", "ATB", "PE", "SFG", "ALR", "COTE", "TVBETETF", "NC"];

async function getJson(u: string) {
  for (let k = 0; k < 3; k++) {
    try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 700));
  }
  return null;
}
async function getText(u: string) {
  for (let k = 0; k < 3; k++) {
    try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.text(); } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 700));
  }
  return null;
}

async function refreshOne(sym: string, old: any | null) {
  const fresh = old?.t?.length && old?.o?.length === old.t.length && old.t[old.t.length - 1] > Math.floor(Date.now() / 864e5) - 60;
  const y = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}.RO?range=${fresh ? "3mo" : "10y"}&interval=1d&events=div`);
  let data = y ? fromYahoo(sym, y, 6) : null;
  if (data && fresh) {
    // Merge the last 3 months onto what we had. Adjusted prices shift after a dividend, so rescale the old part.
    const firstNew = data.t[0];
    const keep = old.t.findIndex((d: number) => d >= firstNew);
    const cut = keep < 0 ? old.t.length : keep;
    const overlapOld = keep >= 0 ? old.a[keep] : null, overlapNew = data.a[0];
    const k = overlapOld && overlapNew && old.t[keep] === firstNew ? overlapNew / overlapOld : 1;
    const minDay = Math.floor(Date.now() / 864e5) - 6 * 366;
    const idx = old.t.slice(0, cut).map((d: number, i: number) => i).filter((i: number) => old.t[i] >= minDay);
    data = {
      ...data,
      t: [...idx.map((i: number) => old.t[i]), ...data.t],
      c: [...idx.map((i: number) => old.c[i]), ...data.c],
      o: [...idx.map((i: number) => old.o[i]), ...(data.o ?? [])],
      h: [...idx.map((i: number) => old.h[i]), ...(data.h ?? [])],
      l: [...idx.map((i: number) => old.l[i]), ...(data.l ?? [])],
      a: [...idx.map((i: number) => Math.round(old.a[i] * k * 1e4) / 1e4), ...data.a],
      v: [...idx.map((i: number) => old.v?.[i] ?? 0), ...(data.v ?? [])],
      divs: [...(old.divs ?? []).filter((d: any) => d.d < firstNew && d.d >= minDay), ...(data.divs ?? [])],
    };
  }
  const html = await getText(`https://www.bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=${encodeURIComponent(sym)}`);
  const f = html ? parseBvbIndicators(html) : null;
  if (!data && !f) return false;
  const row: any = { symbol: sym, updated_on: todayRo(), updated_at: new Date().toISOString() };
  if (data) Object.assign(row, { t: data.t, c: data.c, o: data.o, h: data.h, l: data.l, a: data.a, v: data.v, divs: data.divs });
  if (f) Object.assign(row, { per: f.per, pbv: f.pbv, eps: f.eps, divy: f.divy, mcap: f.mcap, ...(f.name ? { name: f.name } : {}) });
  const { error } = await db.from("market_stocks").upsert(row, { onConflict: "symbol" });
  if (error) console.log("upsert", sym, error.message);
  return !error;
}

async function sendAlerts(stocks: Map<string, StockData>) {
  const { data: keys } = await db.rpc("get_vapid_keys");
  if (!keys?.public || !keys?.private) return 0;
  webpush.setVapidDetails("mailto:noreply@banii-la-virgula.app", keys.public, keys.private);
  const { data: sets } = await db.from("settings").select("household_id, radar");
  const { data: assets } = await db.from("assets").select("household_id, holdings").not("holdings", "is", null);
  let sent = 0;
  for (const st of sets ?? []) {
    const radar = st.radar ?? {};
    if (radar.alerts === false) continue;
    const owned = new Set<string>((assets ?? []).filter((a: any) => a.household_id === st.household_id).flatMap((a: any) => (a.holdings ?? []).map((h: any) => h.symbol)));
    const watch = new Set<string>([...owned, ...(radar.watch ?? [])]);
    if (!watch.size) continue;
    const last: Record<string, Label> = { ...(radar.last ?? {}) };
    const news: string[] = [];
    for (const sym of watch) {
      const s = stocks.get(sym);
      if (!s || s.t.length < 220) continue;
      const sc = score({ ...s, per: s.per == null ? null : Number(s.per), pbv: s.pbv == null ? null : Number(s.pbv), divy: s.divy == null ? null : Number(s.divy) });
      const before = last[sym];
      last[sym] = sc.label;
      if (!before || before === sc.label) continue;
      if (sc.label === "buy" || (owned.has(sym) && (sc.label === "avoid" || sc.label === "hot"))) news.push(`${sym}: ${LABELS[sc.label].emoji} ${LABELS[sc.label].text} (scor ${sc.total})`);
    }
    await db.from("settings").update({ radar: { ...radar, last } }).eq("household_id", st.household_id);
    if (!news.length) continue;
    const { data: members } = await db.from("members").select("user_id").eq("household_id", st.household_id);
    const { data: subs } = await db.from("push_subs").select("*").in("user_id", (members ?? []).map((m: any) => m.user_id));
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: "📡 Radar BVB", body: news.slice(0, 4).join(" · "), url: "./", tag: "radar" }), { TTL: 12 * 3600 });
        sent++;
      } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({} as any));
  const today = todayRo();

  // Universe: BET + everything somebody owns or follows.
  const { data: assets } = await db.from("assets").select("holdings").not("holdings", "is", null);
  const { data: sets } = await db.from("settings").select("radar");
  const syms = new Set<string>(UNIVERSE);
  for (const a of assets ?? []) for (const h of a.holdings ?? []) syms.add(String(h.symbol).toUpperCase());
  for (const s of sets ?? []) for (const w of s.radar?.watch ?? []) syms.add(String(w).toUpperCase());
  if (Array.isArray(body.add)) for (const w of body.add.slice(0, 5)) syms.add(String(w).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));

  const { data: rows } = await db.from("market_stocks").select("*");
  const bySym = new Map((rows ?? []).map((r: any) => [r.symbol, r]));
  const todo = [...syms].filter(s => bySym.get(s)?.updated_on !== today || !bySym.get(s)?.o).slice(0, 30);
  let updated = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const res = await Promise.all(todo.slice(i, i + 4).map(s => refreshOne(s, bySym.get(s) ?? null).catch(e => { console.log(s, String(e)); return false; })));
    updated += res.filter(Boolean).length;
  }

  let sent = 0;
  if (body.alerts !== false && (updated || body.alerts === true)) {
    const { data: all } = await db.from("market_stocks").select("*");
    const map = new Map<string, StockData>((all ?? []).map((r: any) => [r.symbol, r as StockData]));
    sent = await sendAlerts(map);
  }
  return json({ updated, total: syms.size, sent });
});
