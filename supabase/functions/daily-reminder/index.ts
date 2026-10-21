// Daily push: the expense reminder (only if nothing was logged today) and the quote of the day.
// Also sends security alerts (wrong codes, account changes) from security_log right away.
// Called every 10 minutes by pg_cron and by a trigger on security_log. Quotes come from the published app (dist/quotes.json).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const QUOTES_URL = "https://flaviusdanciu1996-tech.github.io/banii-la-virgula/quotes.json";
const FALLBACK = [{ t: "Fiecare ban are un loc. Când nu i-l dai tu, i-l dă altcineva.", a: "Banii la virgulă" }];
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function localParts(tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
function quoteFor(base: { t: string; a: string }[], date: string, extra: { t: string; a: string }[]) {
  const all = [...base, ...extra];
  const [y, m, d] = date.split("-").map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return all[((day % all.length) + all.length) % all.length];
}

Deno.serve(async () => {
  const { data: keys, error: kErr } = await db.rpc("get_vapid_keys");
  if (kErr || !keys?.public || !keys?.private) return new Response(JSON.stringify({ error: "no keys" }), { status: 500 });
  webpush.setVapidDetails("mailto:noreply@banii-la-virgula.app", keys.public, keys.private);
  const { data: subs, error } = await db.from("push_subs").select("*");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let quotes = FALLBACK;
  if ((subs ?? []).some((s: any) => s.quote_on)) {
    try { const r = await fetch(QUOTES_URL); if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) quotes = j; } } catch { /* fallback */ }
  }

  let sent = 0;
  const send = async (s: any, payload: object) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++; return true;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await db.from("push_subs").delete().eq("endpoint", s.endpoint); return null; }
      return false;
    }
  };

  // Security alerts first: they matter more than quotes.
  const { data: alerts } = await db.from("security_log").select("id, user_id, event, detail, at").eq("pushed", false).order("id").limit(50);
  for (const a of alerts ?? []) {
    const title = a.event === "cod_gresit" ? "⚠️ Cineva a încercat să-ți schimbe contul" : "🔐 Schimbare în cont";
    const body = `${a.detail}. Dacă nu ai fost tu: Cont → Securitate → Deconectează celelalte dispozitive și schimbă parola.`;
    for (const s of (subs ?? []).filter((x: any) => x.user_id === a.user_id)) await send(s, { title, body, url: "./", tag: "security-" + a.id });
    await db.from("security_log").update({ pushed: true }).eq("id", a.id);
  }

  for (const s of subs ?? []) {
    let lp; try { lp = localParts(s.tz || "Europe/Bucharest"); } catch { lp = localParts("Europe/Bucharest"); }

    if (s.quote_on && s.quote_last !== lp.date && lp.hm >= String(s.quote_at).slice(0, 5)) {
      const { data: mine } = await db.from("my_quotes").select("text, author").eq("user_id", s.user_id).order("created_at");
      const q = quoteFor(quotes, lp.date, (mine ?? []).map((x: any) => ({ t: x.text, a: x.author || "Citatul tău" })));
      const r = await send(s, { title: "Doza zilei ✨", body: `„${q.t}” — ${q.a}`, url: "./", tag: "daily-quote" });
      if (r === null) continue;
      await db.from("push_subs").update({ quote_last: lp.date }).eq("endpoint", s.endpoint);
    }

    if (s.remind_on && s.last_sent !== lp.date && lp.hm >= String(s.remind_at).slice(0, 5)) {
      const { count } = await db.from("transactions").select("id", { count: "exact", head: true })
        .eq("member_id", s.user_id).eq("date", lp.date).is("recurring_id", null);
      if (!count) {
        const r = await send(s, { title: "Banii la virgulă", body: "Ai trecut cheltuielile de azi? Durează 10 secunde și îți ții seria 🔥", url: "./", tag: "daily-reminder" });
        if (r === null) continue;
      }
      await db.from("push_subs").update({ last_sent: lp.date }).eq("endpoint", s.endpoint);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
