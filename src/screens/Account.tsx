import { useState } from 'react'
import { ChevronRight, Users, Wallet, Palette, UserCog, Info, LogOut, Flame, Gem, Plus, Copy, Bell, Repeat, FileBarChart } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Avatar, Seg, MoneyField, ConfirmButton } from '../ui.tsx'
import { Icon } from '../icons.tsx'
import { fmtNum, parseMoney } from '../lib/money.ts'
import { recordDays, streak, points, totalBudget } from '../lib/calc.ts'
import { todayIso } from '../lib/period.ts'
import { GROUPS, type Category } from '../lib/types.ts'
import { supabase, DEMO } from '../db.ts'
import type { Nav } from '../App.tsx'

export function AccountScreen({ nav, onLogout }: { nav: Nav; onLogout: () => void }) {
  const st = useStore()
  const me = st.members.find(m => m.user_id === st.user.id)
  const name = me?.display_name || st.user.name || st.user.email
  const days = recordDays(st.txs, st.user.id)
  const s = streak(days, todayIso())
  const p = points(st.txs, st.user.id)
  const msg = s >= 2 ? `Ai trecut cheltuieli în fiecare dintre ultimele ${s} zile. Continuă așa!`
    : s === 1 ? 'Ai trecut cheltuieli azi sau ieri. Mâine continui seria.'
    : 'Trece o cheltuială azi ca să pornești o serie de zile.'
  const rows: [string, typeof Users, string][] = [
    ['familie', Users, 'Familia mea'], ['finante', Wallet, 'Finanțe'], ['recurente', Repeat, 'Plăți recurente'], ['rapoarte', FileBarChart, 'Rapoarte și taxe'], ['notificari', Bell, 'Notificări și citate'], ['aspect', Palette, 'Aspect'],
    ['setari', UserCog, 'Setări cont'], ['despre', Info, 'Despre aplicație'],
  ]
  return (
    <div className="screen">
      <section className="card profile">
        <Avatar name={name} size={56} />
        <div>
          <h1>{name}</h1>
          <div className="badges">
            <span className="badge streak"><Flame size={14} />{s}</span>
            <span className="badge pts"><Gem size={14} />{p}</span>
          </div>
        </div>
        <p className="note">{msg}</p>
      </section>
      <div className="menu">
        {rows.map(([id, I, label]) => (
          <button key={id} type="button" className="menu-row" onClick={() => nav(id)}><I size={18} />{label}<ChevronRight size={16} className="chev" /></button>
        ))}
        <button type="button" className="menu-row" onClick={onLogout}><LogOut size={18} />Deconectare</button>
      </div>
      <p className="muted small center">Puncte: 1 pentru fiecare intrare (maxim 5 pe zi) și 10 bonus la fiecare 7 zile la rând.</p>
    </div>
  )
}

/* ---------------- Finanțe ---------------- */

export function FinanteScreen({ openCategory, notify }: { openCategory: (c?: Category, kind?: 'in' | 'out') => void; notify: (m: string) => void }) {
  const st = useStore()
  const [payday, setPayday] = useState(String(st.settings.payday))
  const [tb, setTb] = useState(st.settings.total_budget ? fmtNum(st.settings.total_budget) : '')
  const [target, setTarget] = useState(String(st.settings.savings_target_pct))
  const [eur, setEur] = useState(String(st.settings.eur_rate).replace('.', ','))
  const [usd, setUsd] = useState(String(st.settings.usd_rate).replace('.', ','))
  const [err, setErr] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const sumAlloc = totalBudget(st.categories, null)

  async function save() {
    const pd = Number(payday)
    if (!Number.isInteger(pd) || pd < 1 || pd > 31) return setErr('Ziua trebuie să fie între 1 și 31.')
    const t = tb.trim() ? parseMoney(tb) : null
    if (tb.trim() && (t === null || t < 0)) return setErr('Bugetul total nu e valid.')
    const tg = Number(target)
    if (!Number.isFinite(tg) || tg < 0 || tg > 90) return setErr('Ținta de economisire trebuie să fie între 0 și 90%.')
    const e = Number(eur.replace(',', '.')), u = Number(usd.replace(',', '.'))
    if (!(e > 0) || !(u > 0)) return setErr('Cursul trebuie să fie un număr, ex. 4,9768.')
    setErr('')
    try {
      await st.saveSettings({ payday: pd, total_budget: t || null, savings_target_pct: Math.round(tg), eur_rate: e, usd_rate: u })
      notify('Setări salvate')
    } catch (x: any) { setErr(x?.message || 'Nu s-a putut salva.') }
  }

  async function refresh() {
    try {
      await st.refreshRates(true)
      notify('Curs actualizat')
    } catch (x: any) { setErr(x.message) }
  }

  return (
    <div className="screen">
      <section className="card form">
        <h2>Buget</h2>
        <label className="field">Ziua în care îți intră venitul
          <input id="f-payday" inputMode="numeric" value={payday} onChange={e => setPayday(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </label>
        <p className="hint">Perioada bugetului începe în ziua asta. Pune 1 dacă vrei luna calendaristică.</p>
        <label className="field">Buget total lunar (opțional)</label>
        <MoneyField id="f-total" value={tb} onChange={setTb} suffix="lei" />
        <p className="hint">Gol = suma limitelor din categorii (acum {fmtNum(sumAlloc)} lei, fără Economii).</p>
        <label className="field">Ținta de economisire (% din venituri)
          <input id="f-target" inputMode="numeric" value={target} onChange={e => setTarget(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </label>
        <h2 style={{ marginTop: 8 }}>Curs valutar</h2>
        <div className="two">
          <label className="field">1 € în lei<input id="f-eur" inputMode="decimal" value={eur} onChange={e => setEur(e.target.value)} /></label>
          <label className="field">1 $ în lei<input id="f-usd" inputMode="decimal" value={usd} onChange={e => setUsd(e.target.value)} /></label>
        </div>
        <p className="hint">Se ia automat zilnic (curs BCE){st.settings.rates_date ? `, ultima dată pe ${st.settings.rates_date.split('-').reverse().join('.')}` : ''}. <button type="button" className="inline-link" onClick={refresh}>Ia cursul acum</button></p>
        {err && <p className="err">{err}</p>}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </section>

      <section>
        <h2>Categorii și limite</h2>
        {GROUPS.map(g => {
          const cats = st.categories.filter(c => c.kind === 'out' && c.grp === g.id && (showArchived || !c.archived))
          return (
            <div key={g.id} className="cat-block">
              <h3 className="grp-h"><span><i className="dot" style={{ background: g.color }} />{g.name}</span></h3>
              <div className="rows">
                {cats.map(c => (
                  <button key={c.id} type="button" className={'row' + (c.archived ? ' archived' : '')} onClick={() => openCategory(c)}>
                    <span className="row-icon"><Icon name={c.icon} size={17} /></span>
                    <span className="row-main"><b>{c.name}</b>{c.archived && <span className="muted small">arhivată</span>}</span>
                    <span className="num row-amt">{c.allocated ? fmtNum(c.allocated) : 'fără limită'}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <div className="cat-block">
          <h3 className="grp-h"><span><i className="dot" style={{ background: 'var(--in)' }} />Venituri</span></h3>
          <div className="rows">
            {st.categories.filter(c => c.kind === 'in' && (showArchived || !c.archived)).map(c => (
              <button key={c.id} type="button" className="row" onClick={() => openCategory(c)}>
                <span className="row-icon"><Icon name={c.icon} size={17} /></span><span className="row-main"><b>{c.name}</b></span>
              </button>
            ))}
          </div>
        </div>
        <div className="add-row">
          <button type="button" className="ghost-btn" onClick={() => openCategory(undefined, 'out')}><Plus size={16} />Categorie de cheltuieli</button>
          <button type="button" className="ghost-btn" onClick={() => openCategory(undefined, 'in')}><Plus size={16} />De venit</button>
        </div>
        <button type="button" className="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Ascunde arhivatele' : 'Arată și arhivatele'}</button>
      </section>
    </div>
  )
}

/* ---------------- Familia ---------------- */

export function FamilyScreen({ notify, joinCode }: { notify: (m: string) => void; joinCode?: string }) {
  const st = useStore()
  const isOwner = st.members.find(m => m.user_id === st.user.id)?.role === 'owner'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(joinCode || '')
  const [err, setErr] = useState('')
  const link = (c: string) => `${location.origin}${location.pathname}#join-${c}`

  async function invite() {
    setErr('')
    try { await st.createInvite(email.trim()); setEmail(''); notify('Invitație creată') } catch (e: any) { setErr(e?.message || 'Nu s-a putut crea invitația.') }
  }
  async function join() {
    setErr('')
    try {
      await st.repo.rpc('accept_invite', { p_code: code.trim(), p_name: st.user.name })
      notify('Te-ai alăturat familiei'); location.hash = ''; await st.reload()
    } catch (e: any) { setErr(e?.message || 'Codul nu a mers.') }
  }
  async function leave() {
    try { await st.repo.rpc('leave_household', { h: st.householdId }); notify('Ai ieșit din familie'); await st.reload() } catch (e: any) { setErr(e?.message || 'Nu ai putut ieși.') }
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); notify('Copiat') } catch { notify('Selectează și copiază manual') } }

  return (
    <div className="screen">
      <section>
        <h2>Membri</h2>
        <div className="rows">
          {st.members.map(m => (
            <div key={m.user_id} className="row">
              <Avatar name={m.display_name} size={34} />
              <span className="row-main"><b>{m.display_name}{m.user_id === st.user.id ? ' (eu)' : ''}</b><span className="muted small">{m.role === 'owner' ? 'proprietar' : 'membru'}</span></span>
              {isOwner && m.user_id !== st.user.id && <ConfirmButton armedText="Scot?" onConfirm={() => st.removeMember(m.user_id)}>Scoate</ConfirmButton>}
            </div>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="card form">
          <h2>Invită pe cineva</h2>
          <p className="hint">Creezi un cod, i-l trimiți (WhatsApp, SMS), iar persoana îl scrie în aplicație, la Familia mea. Vedeți apoi amândoi aceleași cheltuieli, bugete și avere.</p>
          <label className="field">Pentru cine (opțional, doar ca să știi)<input id="inv-email" value={email} placeholder="ex. nume sau email" onChange={e => setEmail(e.target.value)} /></label>
          <button type="button" className="primary" onClick={invite}><Plus size={16} /> Creează cod de invitație</button>
          {st.invites.filter(i => !i.accepted_at).map(i => (
            <div key={i.id} className="invite">
              <div><b className="num code">{i.code}</b><span className="muted small">{i.email || 'invitație'}</span></div>
              <div className="invite-actions">
                <button type="button" className="ghost-btn" onClick={() => copy(`Intră în Banii la virgulă cu codul ${i.code}: ${link(i.code)}`)}><Copy size={15} />Copiază</button>
                <ConfirmButton armedText="Anulez?" onConfirm={() => st.deleteInvite(i.id)}>Anulează</ConfirmButton>
              </div>
              <p className="muted small break">{link(i.code)}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card form">
        <h2>Am primit un cod</h2>
        <p className="hint">Dacă intri în familia altcuiva, vezi de acum datele familiei. Ce ai trecut până acum singur nu se mai vede în aplicație.</p>
        <label className="field">Cod<input id="join-code" value={code} maxLength={12} placeholder="ex. 7F3A9C21" onChange={e => setCode(e.target.value.toUpperCase())} /></label>
        <ConfirmButton armedText="Sigur intru?" onConfirm={join}>Intră în familie</ConfirmButton>
      </section>

      {st.members.length > 1 && !isOwner && (
        <section><ConfirmButton armedText="Sigur ies?" onConfirm={leave}>Ieși din familie</ConfirmButton></section>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  )
}

/* ---------------- Aspect ---------------- */

export function AspectScreen({ theme, setTheme }: { theme: 'system' | 'light' | 'dark'; setTheme: (t: 'system' | 'light' | 'dark') => void }) {
  return (
    <div className="screen">
      <section className="card form">
        <h2>Temă</h2>
        <Seg label="Temă" value={theme} onChange={setTheme} options={[{ id: 'dark', label: 'Nocturn' }, { id: 'light', label: 'Luminos' }, { id: 'system', label: 'Ca sistemul' }]} />
      </section>
    </div>
  )
}

/* ---------------- Setări cont ---------------- */

export function AccountSettingsScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const me = st.members.find(m => m.user_id === st.user.id)
  const [name, setName] = useState(me?.display_name || '')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  async function saveName() {
    if (!name.trim()) return setErr('Scrie un nume.')
    try { await st.renameMe(name.trim()); if (supabase) await supabase.auth.updateUser({ data: { name: name.trim() } }); notify('Nume salvat'); setErr('') } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }
  async function savePw() {
    if (pw.length < 8) return setErr('Parola trebuie să aibă cel puțin 8 caractere.')
    if (!supabase) return setErr(DEMO ? 'În modul demo nu se poate.' : 'Nu ești conectat.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return setErr(error.message)
    setPw(''); setErr(''); notify('Parola a fost schimbată')
  }
  return (
    <div className="screen">
      <section className="card form">
        <h2>Nume</h2>
        <label className="field">Cum să-ți spunem<input id="acc-name" value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <button type="button" className="primary" onClick={saveName}>Salvează numele</button>
      </section>
      <section className="card form">
        <h2>Email</h2>
        <p className="num">{st.user.email}</p>
      </section>
      <section className="card form">
        <h2>Parolă nouă</h2>
        <label className="field">Parolă nouă<input id="acc-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        <button type="button" className="primary" onClick={savePw}>Schimbă parola</button>
      </section>
      {err && <p className="err">{err}</p>}
    </div>
  )
}

export function AboutScreen() {
  return (
    <div className="screen">
      <section className="card form">
        <h2>Banii la virgulă</h2>
        <p>Aplicația ta de buget: fiecare ban are un loc, la virgulă.</p>
        <p className="muted small">Sumele sunt păstrate exact, în bani, fără rotunjiri. Datele tale stau în contul tău și le vede doar familia ta. Cursul valutar vine zilnic de la Banca Centrală Europeană și îl poți corecta manual.</p>
        <p className="muted small">Versiunea 2.0</p>
      </section>
    </div>
  )
}
