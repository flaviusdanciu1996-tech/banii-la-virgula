import { useEffect, useState } from 'react'
import { BellRing, BellOff } from 'lucide-react'
import { supabase } from './db.ts'

/** ON/OFF for the app's alarms (signals, stops, targets). While paused, nothing is pushed; alerts are kept for later. */
export function useAlarmPause() {
  const [until, setUntil] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  async function load() {
    if (!supabase) return setReady(true)
    const { data } = await supabase.rpc('alarm_pause_until')
    setUntil((data as string | null) || null); setReady(true)
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])
  async function pause(minutes: number) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('set_alarm_pause', { minutes })
    if (error) throw error
    setUntil((data as string | null) || null)
  }
  return { until: until && Date.parse(until) > Date.now() ? until : null, ready, pause }
}

const hhmm = (iso: string) => new Date(iso).toLocaleString('ro-RO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
/** Minutes until tomorrow 08:00 local time (or today, if it is still before 08:00). */
const untilMorning = () => { const d = new Date(), m = new Date(d); m.setHours(8, 0, 0, 0); if (m <= d) m.setDate(m.getDate() + 1); return Math.round((+m - +d) / 60000) }

export function AlarmSwitch({ notify, compact = false }: { notify: (m: string) => void; compact?: boolean }) {
  const { until, ready, pause } = useAlarmPause()
  const [busy, setBusy] = useState(false)
  async function go(min: number, msg: string) {
    setBusy(true)
    try { await pause(min); notify(msg) } catch (e: any) { notify(e?.message || 'Nu am putut schimba alarmele.') } finally { setBusy(false) }
  }
  if (!ready || !supabase) return null
  if (compact) return until ? (
    <button type="button" className="alarm-banner" disabled={busy} onClick={() => go(0, 'Alarmele sunt pornite')}>
      <BellOff size={16} /> <span>Alarme oprite până {hhmm(until)}</span> <b>Pornește</b>
    </button>
  ) : null
  return (
    <section className={'card form alarm-switch' + (until ? ' off' : '')}>
      <h2>{until ? <BellOff size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> : <BellRing size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />}Alarmele: {until ? 'OPRITE' : 'PORNITE'}</h2>
      {until ? <>
        <p className="note">Nu primești nicio notificare până <b>{hhmm(until)}</b>. Semnalele de acum se păstrează în aplicație. Apoi pornesc singure.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => go(0, 'Alarmele sunt pornite')}>🔔 Pornește-le acum</button>
      </> : <>
        <p className="note">Semnalele ⭐ și 👀, stopurile, țintele și dividendele sună pe telefon. Când dormi sau conduci, oprește-le pentru o vreme.</p>
        <div className="chips">
          <button type="button" className="chip" disabled={busy} onClick={() => go(120, 'Alarme oprite 2 ore')}>🔕 2 ore</button>
          <button type="button" className="chip" disabled={busy} onClick={() => go(480, 'Alarme oprite 8 ore')}>🔕 8 ore</button>
          <button type="button" className="chip" disabled={busy} onClick={() => go(untilMorning(), 'Alarme oprite până la 8:00')}>🌙 Până la 8:00</button>
        </div>
      </>}
    </section>
  )
}
