// Sends a 6-digit SMS code to the account's saved phone number (second code for account changes).
// Ready but OFF: it works only after the Twilio secrets are set (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM)
// and app_flags 'sms' is switched on. Until then it answers 503 sms_off and the app asks for the email code only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user?.id ?? null;
}
async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const uid = await userId(req);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const sid = Deno.env.get("TWILIO_SID"), tok = Deno.env.get("TWILIO_TOKEN"), from = Deno.env.get("TWILIO_FROM");
  const { data: flag } = await db.from("app_flags").select("enabled").eq("key", "sms").maybeSingle();
  if (!sid || !tok || !from || !flag?.enabled) return json({ error: "sms_off" }, 503);

  const { data: sec } = await db.from("account_security").select("phone, sms_sent_at").eq("user_id", uid).maybeSingle();
  if (!sec?.phone) return json({ error: "no_phone" }, 400);
  if (sec.sms_sent_at && Date.now() - new Date(sec.sms_sent_at).getTime() < 60_000) return json({ error: "wait" }, 429);

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await db.from("account_security").update({ sms_hash: await sha256hex(uid + code), sms_sent_at: new Date().toISOString() }).eq("user_id", uid);

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: sec.phone, From: from, Body: `Banii la virgulă: codul tău este ${code}. Nu-l da nimănui.` }),
  });
  if (!r.ok) return json({ error: "send_failed" }, 502);
  return json({ ok: true, to: "…" + sec.phone.slice(-3) });
});
