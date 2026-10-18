import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase } from '../db.ts'

const VAPID_PUBLIC = 'BHijNx8w9dKhabJ0d_oogzCO4qI61LBL-L7x_LHZHFxXI35AT3HJDaE9bt8fPeK6EitI9miZjAL0406NUsQc_FA'

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export function ReminderScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [enabled, setEnabled] = useState(false)
  const [time, setTime] = useState('21:00')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!supported || !supabase) return
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!sub) return
        const { data } = await supabase.from('push_subs').select('remind_at').eq('endpoint', sub.endpoint).maybeSingle()
        if (data) { setEnabled(true); setTime(String(data.remind_at).slice(0, 5)) }
      } catch { /* ignore */ }
    })()
  }, [supported])

  async function save(on: boolean, t = time) {
    setErr(''); setBusy(true)
    try {
      if (!supabase) throw new Error('În modul demo nu se poate.')
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!on) {
        if (sub) { await supabase.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
        setEnabled(false); notify('Memento oprit'); return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('Ai refuzat notificările. Le poți permite din setările telefonului → Aplicații → Chrome → Notificări.')
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) as unknown as BufferSource })
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Bucharest'
      const { error } = await supabase.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: st.user.id, remind_at: t, tz, last_sent: null }, { onConflict: 'endpoint' })
      if (error) throw new Error(error.message)
      setEnabled(true); notify(`Memento setat la ${t}`)
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut porni mementoul.') }
    finally { setBusy(false) }
  }

  async function test() {
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('Banii la virgulă', { body: 'Așa arată mementoul tău zilnic 🔥', icon: 'icon-192.png', tag: 'test' })
    } catch { setErr('Nu am putut arăta notificarea. Verifică dacă ai permis notificările.') }
  }

  if (!supported) return (
    <div className="screen"><div className="card form"><h2>Memento zilnic</h2>
      <p className="note">Telefonul sau browserul ăsta nu permite notificări. Instalează aplicația din Chrome și deschide-o de pe ecran, apoi încearcă din nou.</p></div></div>
  )

  return (
    <div className="screen">
      <section className="card form">
        <h2><Bell size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />Memento zilnic</h2>
        <p className="note">În fiecare zi, la ora aleasă, primești o notificare dacă n-ai trecut încă nicio cheltuială. Dacă ai trecut deja, nu te deranjează.</p>
        <label className="switch">Pornit<input id="rem-on" type="checkbox" checked={enabled} disabled={busy} onChange={e => save(e.target.checked)} /></label>
        <label className="field">La ce oră<input id="rem-time" type="time" value={time} onChange={e => { setTime(e.target.value); if (enabled) save(true, e.target.value) }} /></label>
        {enabled && <button type="button" className="ghost-btn" onClick={test}>Arată o notificare de probă</button>}
        {err && <p className="err">{err}</p>}
        <p className="hint">Merge cel mai bine cu aplicația instalată pe ecran. Pe unele telefoane trebuie să lași Chrome să trimită notificări și când e în fundal.</p>
      </section>
    </div>
  )
}
