// Course-lesson transcription helper. Deployed only while a lesson is being transcribed;
// the rest of the time the live function is a 410 stub so nobody can use the Gemini key through it.
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding@1/base64';
const KEY = Deno.env.get('GEMINI_API_KEY')!;
Deno.serve(async (req) => {
  try {
    const { url, key, mime, prompt } = await req.json();
    const raw = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const k = await crypto.subtle.importKey('raw', decodeBase64(key), 'AES-GCM', false, ['decrypt']);
    const audio = encodeBase64(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12))));
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: audio } }, { text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 16000 } });
    const errs: string[] = [];
    for (const m of ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash']) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const j = await r.json();
      const t = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('');
      if (t) return Response.json({ model: m, text: t });
      errs.push(`${m}:${r.status}`);
    }
    return Response.json({ err: errs.join(' ') });
  } catch (e) { return Response.json({ err: String(e) }); }
});
