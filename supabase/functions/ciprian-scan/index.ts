// Hourly scanner: Ciprian's entry (strong breakout → calm pullback → pullback line broken on volume) on 1h or 4h
// candles, for a slice of the radar's coin universe. New signals are stored once per structure and pushed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ciprianIntraday, type Candle } from "./intraday.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ro = (x: number) => x.toLocaleString("ro-RO", { maximumSignificantDigits: 5 });
const pct = (x: number) => x.toLocaleString("ro-RO", { maximumFractionDigits: 1 });

Deno.serve(async (req) => {
  const { tf = "1h", from = 0, to = 100, dry = false, hist = false, minRR = 1 } = await req.json().catch(() => ({}));
  if (tf !== "1h" && tf !== "4h") return Response.json({ error: "tf" }, { status: 400 });
  const { data: uni } = await db.from("crypto_radar").select("d").eq("coin", "__universe__").maybeSingle();
  const coins: string[] = (uni?.d?.coins ?? []).slice(from, to);
  const { data: rows } = await db.from("crypto_radar").select("coin, area:d->>area, zone:d->>zone").in("coin", coins);
  const area = new Map((rows ?? []).map((r: any) => [r.coin, r.area as string | null]));
  const found: any[] = [];
  for (let i = 0; i < coins.length; i += 10) {
    await Promise.all(coins.slice(i, i + 10).map(async (coin) => {
      try {
        if (area.get(coin) === "sus") return; // "în zonă înaltă nu cumperi"
        const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=${tf}&limit=${hist ? 1000 : 200}`);
        const raw: any[] = await r.json();
        if (!Array.isArray(raw)) return;
        const closed = raw.filter((k) => Number(k[6]) < Date.now()); // only finished candles
        const cs: Candle[] = closed.map((k) => ({ t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
        if (hist) { // backtest: every past signal and whether TP1 or the stop came first
          const seen = new Set<string>();
          for (let n = 120; n < cs.length; n++) {
            const s = ciprianIntraday(cs.slice(0, n + 1));
            if (!s || seen.has(s.key)) continue;
            seen.add(s.key);
            let out = "deschis", best = 0, res = 0, q = n + 1;
            const R = s.entry - s.stop;
            for (; q < cs.length; q++) {
              best = Math.max(best, (cs[q].h / s.entry - 1) * 100);
              if (cs[q].l <= s.stop) { out = "stop"; res = -1; break }
              if (cs[q].h >= s.tp1) { out = "tp1"; res = 0.5 * s.rr1; break }
            }
            if (out === "tp1") { // the other half: stop at entry, exit at TP2
              let done = false;
              for (q = q + 1; q < cs.length; q++) {
                if (cs[q].l <= s.entry) { done = true; break }
                if (cs[q].h >= s.tp2) { res += 0.5 * (s.tp2 - s.entry) / R; done = true; break }
              }
              if (!done) res += 0.5 * (cs[cs.length - 1].c - s.entry) / R;
            }
            found.push({ coin, at: new Date(s.at).toISOString().slice(5, 13), out, risk: +s.riskPct.toFixed(1), rr1: +s.rr1.toFixed(2), best: +best.toFixed(1), res: +(res - 0.2 / s.riskPct).toFixed(3) });
          }
          return;
        }
        const s = ciprianIntraday(cs);
        // Backtest Oct 2026 (201 coins, 1h): only setups with TP1 at least 1× the risk away paid off after fees.
        if (s && s.rr1 >= minRR) found.push({ coin, ...s, area: area.get(coin) ?? null });
      } catch { /* skip coin */ }
    }));
  }
  if (dry || hist) return Response.json(found);
  // Live result of past signals (once per run, on the first slice): TP1 or stop first?
  if (from === 0) {
    const { data: open } = await db.from("ciprian_signals").select("id, coin, tf, candle_at, entry, stop, tp1").is("outcome", null).gte("candle_at", new Date(Date.now() - 14 * 864e5).toISOString());
    for (const s of open ?? []) {
      try {
        const start = Date.parse(s.candle_at) + 3600e3;
        const raw: any[] = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${s.coin}USDT&interval=1h&startTime=${start}&limit=1000`)).json();
        if (!Array.isArray(raw)) continue;
        let outcome: string | null = null, at = 0, best = 0;
        for (const k of raw) {
          if (Number(k[6]) > Date.now()) break;
          best = Math.max(best, (+k[2] / +s.entry - 1) * 100);
          if (+k[3] <= +s.stop) { outcome = "stop"; at = +k[0]; break }
          if (+k[2] >= +s.tp1) { outcome = "tp1"; at = +k[0]; break }
        }
        await db.from("ciprian_signals").update({ best_pct: +best.toFixed(2), ...(outcome ? { outcome, outcome_at: new Date(at).toISOString() } : {}) }).eq("id", s.id);
      } catch { /* next */ }
    }
  }
  // Store once per structure; push only the new ones (max 3 per run, the rest stay visible in the app).
  const fresh: any[] = [];
  for (const s of found) {
    const { error } = await db.from("ciprian_signals").insert({
      coin: s.coin, tf, skey: s.key, candle_at: new Date(s.at).toISOString(), entry: s.entry, stop: s.stop, tp1: s.tp1, tp2: s.tp2,
      line: s.line, pullback_low: s.pullbackLow, top: s.top, risk_pct: s.riskPct, rr1: s.rr1, vol_x: s.volX, area: s.area,
    });
    if (!error) fresh.push(s);
  }
  if (fresh.length) {
    // Only people who follow the crypto radar (have at least one coin on watch) get these alerts.
    const { data: subs } = await db.from("radar_watch").select("user_id");
    const users = [...new Set((subs ?? []).map((x: any) => x.user_id))];
    const tfTxt = tf === "1h" ? "1 oră" : "4 ore";
    for (const s of fresh.sort((a, b) => b.rr1 - a.rr1).slice(0, 3)) {
      const body = `Pullback cu lumânări mici, apoi a spart linia retragerii cu volum ${pct(s.volX)}×. ` +
        `Intrare ~${ro(s.entry)} $ · stop ${ro(s.stop)} (−${pct(s.riskPct)}%) · TP1 ${ro(s.tp1)} (vinzi jumătate, stopul la intrare) · TP2 ${ro(s.tp2)}.` +
        ` Cu risc de 40 lei (1%): poziție de ~${Math.round(40 / (s.riskPct / 100))} lei.${s.area ? ` Zona pe 1 zi: ${s.area}.` : ""} Verifică graficul în TradingView înainte să intri.`;
      for (const u of users) await db.from("push_alerts").insert({ user_id: u, urgent: true, tag: `cip-${tf}-${s.coin}`, title: `⭐ Ciprian · ${s.coin} pe ${tfTxt}: momentul intrării`, body });
    }
    await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/daily-reminder", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` }, body: JSON.stringify({ alerts: true }) }).catch(() => {});
  }
  return Response.json({ scanned: coins.length, found: found.length, fresh: fresh.map((s) => s.coin) });
});
