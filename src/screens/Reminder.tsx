import { useEffect, useState } from 'react'
import { Bell, Sparkles, Plus } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase } from '../db.ts'
import { ConfirmButton } from '../ui.tsx'
import type { Quote } from '../lib/quotes.ts'

const VAPID_PUBLIC = 'BHijNx8w9dKhabJ0d_oogzCO4qI61LBL-L7x_LHZHFxXI35AT3HJDaE9bt8fPeK6EitI9miZjAL0406NUsQc_FA'

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

interface MyQuote { id: string; text: string; author: string }

/** The signed-in user's own quotes (empty in demo mode). */
export function useMyQuotes(): [MyQuote[], () => Promise<void>] {
  const [list, setList] = useState<MyQuote[]>([])
  const load = async () => {
    if (!supabase) return
    const { data } = await supabase.from('my_quotes').select('id, text, author').order('created_at')
    setList((data as MyQuote[]) || [])
  }
  useEffect(() => { load() }, [])
  return [list, load]
}
export const asQuotes = (l: MyQuote[]): Quote[] => l.map(q => ({ t: q.text, a: q.author || 'Citatul tău' }))

type Prefs = { remind_on: boolean; remind_at: string; quote_on: boolean; quote_at: string }

export function ReminderScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [prefs, setPrefs] = useState<Prefs>({ remind_on: false, remind_at: '21:00', quote_on: false, quote_at: '08:00' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [mine, reloadMine] = useMyQuotes()
  const [qText, setQText] = useState('')
  const [qAuthor, setQAuthor] = useState('')

  useEffect(() => {
    if (!supported || !supabase) return
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!sub) return
        const { data } = await supabase.from('push_subs').select('remind_on, remind_at, quote_on, quote_at').eq('endpoint', sub.endpoint).maybeSingle()
        if (data) setPrefs({ remind_on: data.remind_on, remind_at: String(data.remind_at).slice(0, 5), quote_on: data.quote_on, quote_at: String(data.quote_at).slice(0, 5) })
      } catch { /* ignore */ }
    })()
  }, [supported])

  async function apply(next: Prefs, msg: string) {
    setErr(''); setBusy(true)
    try {
      if (!supabase) throw new Error('În modul demo nu se poate.')
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!next.remind_on && !next.quote_on) {
        if (sub) { await supabase.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
        setPrefs(next); notify('Notificări oprite'); return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('Ai refuzat notificările. Le poți permite din setările telefonului → Aplicații → Chrome → Notificări.')
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) as unknown as BufferSource })
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Bucharest'
      const { error } = await supabase.from('push_subs').upsert({
        endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: st.user.id, tz,
        remind_on: next.remind_on, remind_at: next.remind_at, quote_on: next.quote_on, quote_at: next.quote_at,
      }, { onConflict: 'endpoint' })
      if (error) throw new Error(error.message)
      setPrefs(next); notify(msg)
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
    finally { setBusy(false) }
  }

  async function test(body: string) {
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('Banii la virgulă', { body, icon: 'icon-192.png', tag: 'test' })
    } catch { setErr('Nu am putut arăta notificarea. Verifică dacă ai permis notificările.') }
  }

  async function addQuote() {
    if (!supabase) return setErr('În modul demo nu se poate.')
    if (qText.trim().length < 3) return setErr('Scrie citatul (cel puțin câteva cuvinte).')
    const { error } = await supabase.from('my_quotes').insert({ user_id: st.user.id, text: qText.trim(), author: qAuthor.trim() })
    if (error) return setErr(error.message)
    setQText(''); setQAuthor(''); setErr(''); await reloadMine(); notify('Citat adăugat în rotație')
  }

  if (!supported) return (
    <div className="screen"><div className="card form"><h2>Notificări</h2>
      <p className="note">Telefonul sau browserul ăsta nu permite notificări. Instalează aplicația din Chrome și deschide-o de pe ecran, apoi încearcă din nou.</p></div></div>
  )

  return (
    <div className="screen">
      <section className="card form">
        <h2><Sparkles size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />Citatul zilei</h2>
        <p className="note">În fiecare dimineață, o doză de motivație: despre bani, disciplină, curaj și viață.</p>
        <label className="switch">Pornit<input id="q-on" type="checkbox" checked={prefs.quote_on} disabled={busy} onChange={e => apply({ ...prefs, quote_on: e.target.checked }, e.target.checked ? `Citatul vine zilnic la ${prefs.quote_at}` : 'Citatul zilei oprit')} /></label>
        <label className="field">La ce oră<input id="q-time" type="time" value={prefs.quote_at} onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, quote_at: v })); if (prefs.quote_on) apply({ ...prefs, quote_at: v }, `Citatul vine zilnic la ${v}`) }} /></label>
        {prefs.quote_on && <button type="button" className="ghost-btn" onClick={() => test('„Fiecare ban are un loc.” Așa arată doza ta zilnică ✨')}>Arată o notificare de probă</button>}
      </section>

      <section className="card form">
        <h2><Bell size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />Memento cheltuieli</h2>
        <p className="note">Seara, dacă n-ai trecut încă nicio cheltuială, primești un memento. Dacă ai trecut, nu te deranjează.</p>
        <label className="switch">Pornit<input id="rem-on" type="checkbox" checked={prefs.remind_on} disabled={busy} onChange={e => apply({ ...prefs, remind_on: e.target.checked }, e.target.checked ? `Memento setat la ${prefs.remind_at}` : 'Memento oprit')} /></label>
        <label className="field">La ce oră<input id="rem-time" type="time" value={prefs.remind_at} onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, remind_at: v })); if (prefs.remind_on) apply({ ...prefs, remind_at: v }, `Memento setat la ${v}`) }} /></label>
        {prefs.remind_on && <button type="button" className="ghost-btn" onClick={() => test('Ai trecut cheltuielile de azi? 🔥')}>Arată o notificare de probă</button>}
      </section>

      <section className="card form">
        <h2>Citatele mele</h2>
        <p className="note">Adaugă citatele tale preferate sau ale tale. Intră în rotație împreună cu celelalte.</p>
        {mine.length > 0 && (
          <div className="rows">
            {mine.map(q => (
              <div key={q.id} className="row">
                <span className="row-main"><b style={{ fontWeight: 500 }}>„{q.text}”</b><span className="muted small">{q.author || 'Citatul tău'}</span></span>
                <ConfirmButton onConfirm={async () => { await supabase!.from('my_quotes').delete().eq('id', q.id); await reloadMine() }} />
              </div>
            ))}
          </div>
        )}
        <label className="field">Citat<input id="q-text" maxLength={300} value={qText} placeholder="ex. Disciplina bate motivația." onChange={e => setQText(e.target.value)} /></label>
        <label className="field">Autor (opțional)<input id="q-author" maxLength={60} value={qAuthor} onChange={e => setQAuthor(e.target.value)} /></label>
        <button type="button" className="primary" onClick={addQuote}><Plus size={16} /> Adaugă citatul</button>
      </section>

      {err && <p className="err">{err}</p>}
      <p className="hint">Notificările merg cel mai bine cu aplicația instalată pe ecran. Pe unele telefoane trebuie să lași Chrome să trimită notificări și când e în fundal.</p>
    </div>
  )
}
