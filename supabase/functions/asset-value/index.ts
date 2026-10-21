// Monthly value of things that lose value (phone, car…). Daily: BVB prices for brokers, Revolut X prices for crypto.
// 1) Reads current second-hand listings for the exact model from OLX and Publi24 (public search pages).
// 2) With at least 5 listings: median price minus a discount (asking price → selling price).
// 3) Otherwise: yearly depreciation from the last known value.
// Called by pg_cron once a day (processes only assets whose month has passed) and by the app ("Verifică acum").
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { marketValue, anchorPoint, estimateOn, checkDue, olxUrl, publi24Url, parseOlx, parsePubli24, pickOffers, type Offer, type ValuePoint } from "./valuation.ts";
import { bvbUrl, parseBvbPrice, holdingsValue, type Holding } from "./bvb.ts";
import { positions, pickPair, quoteFromTickers, type CoinQuote, type CryptoTx } from "./crypto.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const todayRo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const lei = (minor: number) => new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0, useGrouping: "always" as any }).format(Math.round(minor / 100));

const UA = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36", "Accept-Language": "ro-RO,ro;q=0.9" };

/** Reads the public search results on OLX and Publi24 (one page each, once a month) and keeps exact matches. */
export async function searchOffers(query: string): Promise<{ offers: Offer[]; error?: string }> {
  const pages: [string, (h: string) => any[]][] = [[olxUrl(query), parseOlx], [olxUrl(query, 2), parseOlx], [publi24Url(query), parsePubli24]];
  const all: any[] = [];
  let failed = 0;
  await Promise.all(pages.map(async ([u, parse]) => {
    try {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { failed++; console.log(u, r.status); return; }
      all.push(...parse(await r.text()));
    } catch (e) { failed++; console.log(u, String(e)); }
  }));
  return { offers: pickOffers(all, query), error: failed === pages.length ? "sites_unreachable" : undefined };
}

async function notify(userId: string, title: string, body: string) {
  const { data: subs } = await db.from("push_subs").select("*").eq("user_id", userId);
  if (!subs?.length) return;
  const { data: keys } = await db.rpc("get_vapid_keys");
  if (!keys?.public || !keys?.private) return;
  webpush.setVapidDetails("mailto:noreply@banii-la-virgula.app", keys.public, keys.private);
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: "./", tag: "asset-value" }), { TTL: 24 * 3600 }); }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }
}

/** Investments: today's BVB price for every position, value = positions + cash left in the account. */
async function priceInvestments(a: any) {
  const today = todayRo();
  const holdings: Holding[] = (a.holdings ?? []).map((h: any) => ({ ...h }));
  let priced = 0;
  for (const h of holdings) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(bvbUrl(h.symbol), { headers: UA, signal: AbortSignal.timeout(15000) });
        const p = r.ok ? parseBvbPrice(await r.text()) : null;
        if (p) { h.price = p; priced++; }
        break;
      } catch (e) { console.log("bvb", h.symbol, attempt, String(e)); await new Promise(res => setTimeout(res, 800)); }
    }
  }
  const cash = Number(a.invest_summary?.cash ?? 0);
  const value = holdingsValue(holdings) + Math.max(0, cash);
  await db.from("assets").update({ holdings, value, updated_on: today, prices_on: today, value_source: "market" }).eq("id", a.id);
  await db.from("asset_values").upsert({ household_id: a.household_id, asset_id: a.id, day: today, value, source: "market" }, { onConflict: "asset_id,day" });
  return { id: a.id, value, priced, positions: holdings.length };
}

// ---------- Crypto: positions from the user's transactions, live prices from Revolut X (public, no key) ----------
const RX = "https://revx.revolut.com/api/1.0/public";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function rx(path: string): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(RX + path, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(Number(r.headers.get("Retry-After")) || 1200); continue; }
      if (!r.ok) { console.log("revx", path, r.status); return null; }
      return await r.json();
    } catch (e) { console.log("revx", path, String(e)); await sleep(800); }
  }
  return null;
}

async function priceCrypto(a: any) {
  const today = todayRo();
  const { data: rows } = await db.from("crypto_tx").select("*").eq("asset_id", a.id).limit(20000);
  if (!rows?.length) return { id: a.id, value: Number(a.value), priced: 0, positions: 0 }; // typed by hand: leave it alone
  const txs: CryptoTx[] = rows.map((r: any) => ({ ...r, qty: Number(r.qty), price: r.price == null ? null : Number(r.price), fee: Number(r.fee), fx: r.fx == null ? null : Number(r.fx) }));
  const { data: set } = await db.from("settings").select("eur_rate,usd_rate").eq("household_id", a.household_id).maybeSingle();
  const rates = { EUR: Number(set?.eur_rate) || 5, USD: Number(set?.usd_rate) || 4.6 };
  const held = positions(txs).filter(p => p.qty > 0).map(p => p.coin);
  const old = new Map<string, CoinQuote>((a.coins ?? []).map((c: CoinQuote) => [c.coin, c]));
  const quotes: CoinQuote[] = held.map(c => ({ coin: c, pair: old.get(c)?.pair ?? null, price: null, ch24: null, at: null, spark: old.get(c)?.spark, spark_on: old.get(c)?.spark_on ?? null }));
  if (quotes.some(x => !x.pair)) {
    const cfg = await rx("/configuration/pairs");
    const pairs = cfg ? Object.keys(cfg) : [];
    for (const x of quotes) if (!x.pair) x.pair = pickPair(x.coin, pairs);
  }
  const withPair = quotes.filter(x => x.pair);
  let priced = 0;
  if (withPair.length) {
    const t = await rx("/tickers?symbols=" + encodeURIComponent(withPair.map(x => x.pair!.replace("/", "-")).join(",")));
    const list = Array.isArray(t?.data) ? t.data : [];
    for (const x of withPair) {
      const q = quoteFromTickers(x.pair!, list, rates);
      if (q) { x.price = q.price; x.ch24 = q.ch24; x.at = new Date().toISOString(); priced++; }
    }
  }
  for (const x of quotes) {
    const o = old.get(x.coin);
    if (x.price == null && o?.price != null) { x.price = o.price; x.ch24 = o.ch24; x.at = o.at; } // keep the last known price
  }
  // 30-day mini chart, once a day per coin (1 request per second is the public limit).
  for (const x of withPair) {
    if (x.spark_on === today) continue;
    await sleep(1100);
    const c = await rx(`/candles/${x.pair!.replace("/", "-")}?interval=1440&since=${Date.now() - 31 * 864e5}`);
    const closes = (Array.isArray(c?.data) ? c.data : []).map((k: any) => Number(k.close)).filter((v: number) => v > 0);
    if (closes.length) { const fx = x.pair!.endsWith("/EUR") ? rates.EUR : rates.USD; x.spark = closes.map((v: number) => Math.round(v * fx * 10000) / 10000); x.spark_on = today; }
  }
  const pos = positions(txs, quotes);
  const value = Math.round(pos.reduce((s, p) => s + p.value, 0) * 100);
  const invested = Math.round(pos.reduce((s, p) => s + p.cost, 0) * 100);
  await db.from("assets").update({ coins: quotes, value, invested, updated_on: today, prices_on: today, value_source: "market" }).eq("id", a.id);
  await db.from("asset_values").upsert({ household_id: a.household_id, asset_id: a.id, day: today, value, source: "market" }, { onConflict: "asset_id,day" });
  return { id: a.id, value, priced, positions: held.length };
}

async function valueAsset(a: any, push: boolean) {
  if (a.kind === "crypto") return priceCrypto(a);
  if (Array.isArray(a.holdings) && a.holdings.length) return priceInvestments(a);
  const today = todayRo();
  const { data: set } = await db.from("settings").select("eur_rate,usd_rate").eq("household_id", a.household_id).maybeSingle();
  const rates: Record<string, number> = { RON: 1, EUR: Number(set?.eur_rate) || 5, USD: Number(set?.usd_rate) || 4.6 };

  let found: Offer[] = [], market: ReturnType<typeof marketValue> = null, searchError: string | undefined;
  if (a.market_on && a.market_query) {
    const s = await searchOffers(a.market_query);
    found = s.offers; searchError = s.error;
    market = marketValue(found, a.currency, rates, a.market_discount ?? 10);
  }
  let value: number | null = null, source = "";
  if (market) { value = market.value; source = "market"; }
  else if (a.dep_rate) {
    const { data: hist } = await db.from("asset_values").select("day,value,source").eq("asset_id", a.id);
    const anchor = anchorPoint((hist ?? []) as ValuePoint[], { value: a.purchase_price, day: a.purchase_date })
      ?? { day: a.updated_on, value: Number(a.value), source: "manual" };
    value = estimateOn(today, a.dep_rate, anchor);
    source = "depreciation";
  }

  const offersOut = market ? market.offers : found.map(o => ({ ...o, used: false }));
  const patch: Record<string, unknown> = { market_checked_on: today, market_offers: offersOut.length ? offersOut : null };
  const prev = Number(a.value);
  if (value !== null) {
    Object.assign(patch, { value, updated_on: today, value_source: source });
    await db.from("asset_values").upsert({ household_id: a.household_id, asset_id: a.id, day: today, value, source, offers: market ? market.offers : null }, { onConflict: "asset_id,day" });
  }
  await db.from("assets").update(patch).eq("id", a.id);

  if (push && value !== null && value !== prev) {
    const cur = a.currency === "RON" ? "lei" : a.currency === "EUR" ? "€" : a.currency;
    const diff = value - prev;
    const how = market ? `după ${market.count} oferte online` : `estimat (−${a.dep_rate}%/an)`;
    await notify(a.owner_id, `${a.name} valorează acum ~${lei(value)} ${cur}`, `${diff < 0 ? "−" : "+"}${lei(Math.abs(diff))} ${cur} față de data trecută · ${how}`);
  }
  return { id: a.id, value, source, offers: offersOut, count: market?.count ?? 0, found: found.length, error: searchError };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({} as any));

  // From the app: check one asset now. The caller must belong to the asset's household.
  if (body.asset_id) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: a } = await db.from("assets").select("*").eq("id", body.asset_id).maybeSingle();
    if (!a) return json({ error: "not_found" }, 404);
    const { data: mem } = await db.from("members").select("user_id").eq("household_id", a.household_id).eq("user_id", u.user.id).maybeSingle();
    if (!mem) return json({ error: "forbidden" }, 403);
    return json(await valueAsset(a, false));
  }

  // From pg_cron: every asset whose monthly check is due.
  const today = todayRo();
  const { data: assets } = await db.from("assets").select("*").eq("archived", false).or("market_on.eq.true,dep_rate.gt.0,holdings.not.is.null,kind.eq.crypto");
  const due = (assets ?? []).filter((a: any) => a.kind === "crypto" || (Array.isArray(a.holdings) && a.holdings.length) ? a.prices_on !== today : checkDue(a.market_checked_on, today)).slice(0, 15);
  const out = [];
  for (const a of due) { try { out.push(await valueAsset(a, true)); } catch (e) { console.log("asset", a.id, String(e)); } }
  return json({ checked: out.length });
});
