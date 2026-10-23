// Crypto radar: the ~200 most traded coins on Binance, analysed on 1h … 1 year with our rules.
// pg_cron calls it every few minutes; each call refreshes the coin list once a day, the watched open positions and the stalest coins (20 in all).
// The app calls it too when the radar is old. Binance public market data, no key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyze, toCandles, RADAR_COINS, SKIP, STOCK_TOKEN, type Candle } from "./radar.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOP = 200, BATCH = 20;

async function bn(path: string): Promise<any> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch("https://data-api.binance.vision" + path, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status === 418) await new Promise(res => setTimeout(res, 3000));
      else return null;
    } catch { /* retry */ }
  }
  return null;
}

type Uni = { coins: string[]; tick: Record<string, { ch: number; vol: number }>; at: string };

async function universe(force: boolean): Promise<Uni> {
  const { data } = await db.from("crypto_radar").select("d").eq("coin", "__universe__").maybeSingle();
  const old = data?.d as Uni | undefined;
  if (!force && old && Date.now() - Date.parse(old.at) < 20 * 3600e3) return old;
  const all = await bn("/api/v3/ticker/24hr");
  if (!Array.isArray(all)) return old ?? { coins: RADAR_COINS, tick: {}, at: new Date(0).toISOString() };
  const rows = all.filter((t: any) => typeof t.symbol === "string" && t.symbol.endsWith("USDT"))
    .map((t: any) => ({ coin: t.symbol.slice(0, -4), ch: Number(t.priceChangePercent), vol: Number(t.quoteVolume), n: Number(t.count) }))
    .filter(t => t.coin && !SKIP.test(t.coin) && !STOCK_TOKEN.test(t.coin) && t.vol > 0 && t.n > 0)
    .sort((a, b) => b.vol - a.vol);
  const top = rows.slice(0, TOP);
  for (const c of RADAR_COINS) if (!top.some(t => t.coin === c)) { const r = rows.find(t => t.coin === c); if (r) top.push(r); }
  const u: Uni = { coins: top.map(t => t.coin), tick: Object.fromEntries(top.map(t => [t.coin, { ch: t.ch, vol: t.vol }])), at: new Date().toISOString() };
  await db.from("crypto_radar").upsert({ coin: "__universe__", d: u, at: u.at });
  return u;
}

async function one(coin: string, u: Uni) {
  const s = `${coin}USDT`;
  const [d1, h1, h4, h8, w1, m1] = await Promise.all([
    bn(`/api/v3/klines?symbol=${s}&interval=1d&limit=400`), bn(`/api/v3/klines?symbol=${s}&interval=1h&limit=120`),
    bn(`/api/v3/klines?symbol=${s}&interval=4h&limit=120`), bn(`/api/v3/klines?symbol=${s}&interval=8h&limit=120`),
    bn(`/api/v3/klines?symbol=${s}&interval=1w&limit=120`), bn(`/api/v3/klines?symbol=${s}&interval=1M&limit=60`),
  ]);
  const daily = toCandles(d1);
  if (daily.length < 60) { await db.from("crypto_radar").upsert({ coin, d: { coin, tooNew: true }, at: new Date().toISOString() }); return null; } // too new to judge
  const t = u.tick[coin];
  const row = analyze(coin, daily, toCandles(h4), t?.ch ?? null, { h1: toCandles(h1), h8: toCandles(h8), w1: toCandles(w1), m1: toCandles(m1) }, t?.vol ?? 0);
  await db.from("crypto_radar").upsert({ coin, d: row, at: row.at });
  await levelAlerts(coin, { "4h": toCandles(h4), "1d": daily });
  return row;
}

const ro = (x: number) => x.toLocaleString("ro-RO", { maximumSignificantDigits: 6 });
/** Level alerts on 4h or 1-day candles: the last CLOSED candle ends above the level on ≥ vol_mult × the 20-candle average volume. */
async function levelAlerts(coin: string, series: Record<string, Candle[]>) {
  const { data: rows } = await db.from("crypto_level_alerts").select("*").eq("coin", coin).is("alerted_at", null);
  if (!rows?.length) return;
  let sent = 0;
  for (const a of rows) {
    const cs = series[a.tf] ?? [];
    if (cs.length < 23) continue;
    const k = cs.length - 2, x = cs[k]; // cs[last] is still forming
    const avg = cs.slice(k - 20, k).reduce((s, y) => s + y.v, 0) / 20;
    if (!(x.c > Number(a.above) && x.v >= Number(a.vol_mult) * avg)) continue;
    const tfTxt = a.tf === "1d" ? "pe 1 zi" : "pe 4 ore";
    await db.from("push_alerts").insert({ user_id: a.user_id, urgent: true, tag: `level-${coin}`,
      title: `📡 SEMNAL · ${coin} a spart ${ro(Number(a.above))} $ ${tfTxt} cu volum`,
      body: `Lumânarea ${a.tf === "1d" ? "zilei" : "de 4 ore"} s-a închis la ${ro(x.c)} $, cu volum ${(x.v / avg).toFixed(1)}× normal. Ciprian: nu cumpăra pe loc, așteaptă pullback-ul cu lumânări mici.${a.stop ? ` Stop sub ${ro(Number(a.stop))}` : ""}${a.target ? ` · ținta 1: ${ro(Number(a.target))}` : ""}. Scrie-i lui Claude.` });
    await db.from("crypto_level_alerts").update({ alerted_at: new Date().toISOString() }).eq("id", a.id);
    sent++;
  }
  if (sent) await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/daily-reminder", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` }, body: JSON.stringify({ alerts: true }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({} as any));
  const u = await universe(!!body.refresh_list);
  const { data: have } = await db.from("crypto_radar").select("coin, at").neq("coin", "__universe__");
  const seen = new Map((have ?? []).map((r: any) => [r.coin, Date.parse(r.at)]));
  // Open positions we watch for stop-loss / target (e.g. TSLAB for Tesla) are refreshed on every call, before the rest.
  const { data: pos } = await db.from("invest_journal").select("watch_symbol").eq("status", "deschis").not("watch_symbol", "is", null);
  // Coins with a pending 4h level alert are refreshed on every call too.
  const { data: lv } = await db.from("crypto_level_alerts").select("coin").is("alerted_at", null);
  const watch = [...new Set([...(pos ?? []).map((r: any) => r.watch_symbol as string), ...(lv ?? []).map((r: any) => r.coin as string)])];
  const rest = [...u.coins].filter(c => !watch.includes(c)).sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0));
  const todo = [...watch, ...rest].slice(0, BATCH);
  let done = 0;
  for (let i = 0; i < todo.length; i += 5) {
    const r = await Promise.all(todo.slice(i, i + 5).map(c => one(c, u).catch(e => { console.log(c, String(e)); return null; })));
    done += r.filter(Boolean).length;
  }
  return json({ coins: u.coins.length, done });
});
