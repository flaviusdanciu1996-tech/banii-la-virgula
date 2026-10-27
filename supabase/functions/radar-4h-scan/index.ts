// One-off scan: the radar's Ciprian/Trend reading applied to 4-hour candles for a slice of the coin universe.
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyze, readCiprian, indicators, toCandles } from "https://raw.githubusercontent.com/flaviusdanciu1996-tech/banii-la-virgula/ea6b0299856d6fe9e5c72320aca676a516aeedc7/supabase/functions/crypto-radar/radar.ts";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async (req) => {
  const { from = 0, to = 50 } = await req.json().catch(() => ({}));
  const { data } = await db.from("crypto_radar").select("d").eq("coin", "__universe__").maybeSingle();
  const coins: string[] = (data?.d?.coins ?? []).slice(from, to);
  const out: any[] = [];
  for (let i = 0; i < coins.length; i += 10) {
    await Promise.all(coins.slice(i, i + 10).map(async (coin) => {
      try {
        const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=4h&limit=450`);
        const cs = toCandles(await r.json());
        if (cs.length < 300) return;
        const row = analyze(coin, cs);
        const k = readCiprian(cs, indicators(cs).atr);
        if (row.zone === 'buy' || row.zone === 'wait') out.push({ coin, zone: row.zone, signal: row.signal, price: row.price, stop: row.stop, target: row.target, risk: +row.riskPct.toFixed(1), reward: +row.rewardPct.toFixed(1), area: k.area, speed: k.speed, setup: k.setup, pullback: k.pullback, held: k.held, small: k.smallCandles, calm: k.calmVolume, depth: +k.depth.toFixed(2), deepOk: k.pullbackLow >= k.falseLimit && k.pullbackLow >= k.axis, panic: k.climaxAgo, vol: data?.d?.tick?.[coin]?.vol, note: row.note });
      } catch { /* skip */ }
    }));
  }
  return Response.json(out);
});
