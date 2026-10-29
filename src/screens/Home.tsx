import { useMemo } from 'react'
import { History, LayoutGrid, ArrowLeftRight, Lightbulb, ChevronRight, ChevronLeft, Plus, Minus, CalendarCheck, BellRing, BellOff } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Ring, Bar, Seg, CountUp, EmptyArt } from '../ui.tsx'
import { TxRow, catColor } from '../helpers.tsx'
import { upcomingList, UpcomingRows } from './Plans.tsx'
import { DreamStrip } from './Dreams.tsx'
import { useMyQuotes, asQuotes } from './Reminder.tsx'
import { ReceiptButton } from './Receipt.tsx'
import { quoteFor } from '../lib/quotes.ts'
import { Icon } from '../icons.tsx'
import { fmt, fmtNum, fmtSigned, pct } from '../lib/money.ts'
import { periodLabel, shortDayLabel, todayIso, type Period } from '../lib/period.ts'
import { summarize, netWorth, snapshotAt } from '../lib/calc.ts'
import type { Tx, Recurring, Goal } from '../lib/types.ts'
import { CUR_LABEL } from '../lib/money.ts'
import type { Nav } from '../App.tsx'
import { AlarmSwitch, useAlarmPause } from '../AlarmSwitch.tsx'

function AlarmBell({ onClick }: { onClick: () => void }) {
  const { until, ready } = useAlarmPause()
  if (!ready) return null
  return <button type="button" className={'alarm-bell' + (until ? ' off' : '')} aria-label={until ? 'Alarmele sunt oprite' : 'Alarmele sunt pornite'} onClick={onClick}>{until ? <BellOff size={20} /> : <BellRing size={20} />}</button>
}

export function HomeScreen({ nav, period, setPeriod, scope, setScope, openTx, openRecurring, openGoal, notify }: {
  nav: Nav; period: Period; setPeriod: (n: number) => void; scope: 'all' | 'me'; setScope: (s: 'all' | 'me') => void
  openTx: (t?: Tx, kind?: 'in' | 'out', template?: Partial<Tx>) => void; openRecurring: (r?: Recurring) => void; openGoal: (g?: Goal, add?: boolean) => void; notify: (m: string) => void
}) {
  const st = useStore()
  const today = todayIso()
  const txs = useMemo(() => (scope === 'me' ? st.txs.filter(t => t.member_id === st.user.id) : st.txs), [st.txs, scope, st.user.id])
  const sum = useMemo(() => summarize(txs, st.categories, st.settings, period, today), [txs, st.categories, st.settings, period, today])
  const catById = useMemo(() => new Map(st.categories.map(c => [c.id, c])), [st.categories])

  // Quick add: the last few distinct entries (same category + amount + note) as one-tap templates.
  const templates = useMemo(() => {
    const seen = new Set<string>(), out: Tx[] = []
    for (const t of [...st.txs].filter(t => t.member_id === st.user.id && !t.recurring_id).sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      const k = `${t.kind}|${t.category_id}|${t.orig_currency || 'RON'}|${t.orig_amount ?? t.amount}`
      if (seen.has(k)) continue
      seen.add(k); out.push(t)
      if (out.length >= 6) break
    }
    return out
  }, [st.txs, st.user.id])
  const upcoming = upcomingList(st.recurring, today, 10)
  const [mine] = useMyQuotes()
  const quote = quoteFor(today, asQuotes(mine))

  const nw = netWorth(st.assets, st.rates)
  const monthAgo = snapshotAt(st.snapshots, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
  const firstName = (st.members.find(m => m.user_id === st.user.id)?.display_name || st.user.name || '').split(' ')[0]

  const topCats = [...sum.byCat.entries()]
    .filter(([id]) => catById.get(id)?.grp !== 'economii')
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
  const top3 = sum.txs.filter(t => t.kind === 'out' && catById.get(t.category_id)?.grp !== 'economii').sort((a, b) => b.amount - a.amount).slice(0, 3)
  const over = sum.totalBudget > 0 && sum.left < 0
  const fast = sum.totalBudget > 0 && sum.elapsedPct < 100 && sum.spentPct > sum.elapsedPct + 10

  return (
    <div className="screen">
      <header className="hello">
        <div>
          <h1>Salut{firstName ? `, ${firstName}` : ''}!</h1>
          <p className="muted">Iată situația ta financiară</p>
        </div>
        <AlarmBell onClick={() => nav('notificari')} />
      </header>
      <AlarmSwitch notify={notify} compact />

      <button type="button" className="quote-card" onClick={() => nav('notificari')}>
        <span className="quote-eyebrow">✨ Doza zilei</span>
        <span className="quote-text">„{quote.t}”</span>
        <span className="quote-author">— {quote.a}</span>
      </button>

      {st.members.length > 1 && (
        <Seg label="Ce vezi" value={scope} onChange={setScope} options={[{ id: 'all', label: 'Familie' }, { id: 'me', label: 'Personal' }]} />
      )}

      <div className="period">
        <button type="button" className="icon-btn" aria-label="Perioada anterioară" onClick={() => setPeriod(-1)}><ChevronLeft size={18} /></button>
        <b>{periodLabel(period, st.settings.payday)}</b>
        <button type="button" className="icon-btn" aria-label="Perioada următoare" onClick={() => setPeriod(1)}><ChevronRight size={18} /></button>
      </div>

      <section className="card budget">
        {sum.totalBudget > 0 ? (() => {
          const R1 = 62, R2 = 46, C1 = 2 * Math.PI * R1, C2 = 2 * Math.PI * R2
          const sp = Math.min(100, Math.max(0, sum.spentPct)), el = Math.min(100, Math.max(0, sum.elapsedPct))
          const leftLei = Math.round(Math.abs(sum.left) / 100)
          return <>
            <div className="ring-wrap">
              <svg className="ring" viewBox="0 0 150 150" role="img" aria-label={`Ai cheltuit ${sum.spentPct}% din buget, a trecut ${sum.elapsedPct}% din lună`}>
                <circle cx="75" cy="75" r={R1} className="ring-track" strokeWidth="14" />
                <circle cx="75" cy="75" r={R1} className="ring-spent" strokeWidth="14" stroke={over ? 'var(--bad)' : 'var(--accent)'} strokeDasharray={`${(sp / 100) * C1} ${C1}`} transform="rotate(-90 75 75)" />
                <circle cx="75" cy="75" r={R2} className="ring-track" strokeWidth="5" />
                <circle cx="75" cy="75" r={R2} className="ring-time" strokeWidth="5" strokeDasharray={`${(el / 100) * C2} ${C2}`} transform="rotate(-90 75 75)" />
              </svg>
              <div className="ring-center">
                <span>{over ? 'ai depășit' : 'mai ai'}</span>
                <b className={'num' + (over ? ' neg' : '')}>{fmtNum(leftLei * 100).replace(',00', '')}</b>
                <span>lei</span>
              </div>
            </div>
            <div className="ring-stats">
              <div><span>Cheltuit</span><b className="num">{fmtNum(sum.spent)}</b><small>din {fmtNum(sum.totalBudget).replace(',00', '')}</small></div>
              <div><span>Venituri</span><b className="num in">{fmtNum(sum.income)}</b></div>
              <div><span>Economii</span><b className="num save">{fmtNum(sum.saved)}</b></div>
              <div><span>Investiții</span><b className="num invest">{fmtNum(sum.invested)}</b></div>
            </div>
            <div className="ring-foot">
              <div className="legend"><span><i style={{ background: over ? 'var(--bad)' : 'var(--accent)' }} />cheltuit {sum.spentPct}%</span><span><i style={{ background: 'var(--time)' }} />trecut din lună {sum.elapsedPct}%</span>{sum.daysLeft > 0 && <span className="muted">mai sunt {sum.daysLeft} {sum.daysLeft === 1 ? 'zi' : 'zile'}</span>}</div>
              {fast && <p className="note bad">Cheltui mai repede decât trece luna.</p>}
            </div>
          </>
        })() : <>
          <div className="eyebrow">Mai ai din buget</div>
          <div className="big num">–</div>
          <p className="note">Pune limite pe categorii (sau un buget total) ca să vezi cât mai ai.</p>
          <button type="button" className="link" onClick={() => nav('finante')}>Setează bugetul <ChevronRight size={15} /></button>
          <div className="trio">
            <div><span>Venituri</span><b className="num in">{fmtNum(sum.income)}</b></div>
            <div><span>Cheltuieli</span><b className="num">{fmtNum(sum.spent)}</b></div>
            <div><span>Economii</span><b className="num save">{fmtNum(sum.saved)}</b></div>
            <div><span>Investiții</span><b className="num invest">{fmtNum(sum.invested)}</b></div>
          </div>
        </>}
      </section>

      <button type="button" className="card nw-line" onClick={() => nav('tab:avere')}>
        <span className="muted">Averea ta netă</span>
        <span className="nw-val num">{fmt(nw.net)}</span>
        {monthAgo && <span className={'num small ' + (nw.net - monthAgo.net >= 0 ? 'in' : 'bad')}>{fmtSigned(nw.net - monthAgo.net)} față de acum o lună</span>}
        <ChevronRight size={16} className="chev" />
      </button>

      {st.assets.some(a => a.holdings?.length) && (
        <button type="button" className="card nw-line plan-home" onClick={() => nav('plan')}>
          <span className="muted"><CalendarCheck size={15} /> Planul lunii</span>
          <span className="small">Vezi ce îți propune sistemul să cumperi</span>
          <ChevronRight size={16} className="chev" />
        </button>
      )}

      <DreamStrip openGoal={openGoal} nav={nav} />

      <div className="add-row">
        <button type="button" className="add out" onClick={() => openTx(undefined, 'out')}><Minus size={18} />Cheltuială</button>
        <button type="button" className="add in" onClick={() => openTx(undefined, 'in')}><Plus size={18} />Venit</button>
        <ReceiptButton notify={notify} />
      </div>

      {templates.length > 0 && (
        <div className="quick-add" aria-label="Adaugă rapid din ultimele intrări">
          {templates.map(t => {
            const c = catById.get(t.category_id)
            const foreign = t.orig_currency && t.orig_currency !== 'RON' && t.orig_amount
            return (
              <button key={t.id} type="button" className="qa" onClick={() => openTx(undefined, t.kind, { kind: t.kind, category_id: t.category_id, amount: t.amount, note: t.note, orig_amount: t.orig_amount, orig_currency: t.orig_currency })}>
                <span className="cat-icon" style={{ width: 30, height: 30, ['--c' as any]: catColor(c) }}><Icon name={c?.icon || 'circle'} size={15} /></span>
                <span><b className="num small">{t.kind === 'in' ? '+' : ''}{foreign ? `${fmtNum(t.orig_amount!)} ${CUR_LABEL[t.orig_currency!]}` : fmtNum(t.amount)}</b><small>{t.note || c?.name}</small></span>
              </button>
            )
          })}
        </div>
      )}

      <nav className="quick" aria-label="Scurtături">
        <button type="button" onClick={() => nav('history')}><History size={18} />Istoric</button>
        <button type="button" onClick={() => nav('categories')}><LayoutGrid size={18} />Pe categorii</button>
        <button type="button" onClick={() => nav('tab:stats#compara')}><ArrowLeftRight size={18} />Compară</button>
        <button type="button" onClick={() => nav('tab:stats#recomandari')}><Lightbulb size={18} />Recomandări</button>
      </nav>

      {upcoming.length > 0 && (
        <section>
          <h2>Plăți care urmează</h2>
          <UpcomingRows items={upcoming} onOpen={openRecurring} limit={4} />
          <button type="button" className="link" onClick={() => nav('recurente')}>Toate plățile recurente <ChevronRight size={15} /></button>
        </section>
      )}


      <section>
        <h2>Categoriile cu cele mai mari cheltuieli</h2>
        {topCats.length ? (
          <div className="cat-grid">
            {topCats.map(([id, v]) => {
              const c = catById.get(id)!
                          const ratio = c.allocated ? v / c.allocated : 0
              return (
                <button key={id} type="button" className="cat-card" style={{ ['--c' as any]: catColor(c) }} onClick={() => nav('history', { cat: id })}>
                  <Ring value={c.allocated ? ratio : 1} color={ratio > 1 ? 'var(--bad)' : catColor(c)}><Icon name={c.icon} size={20} color={catColor(c)} /></Ring>
                  <span className="cat-name">{c.name}</span>
                  <b className="num">{fmt(v)}</b>
                  <span className="cat-stats">
                    <span><b className={'num' + (ratio > 1 ? ' bad' : '')}>{c.allocated ? pct(v, c.allocated) + '%' : '–'}</b>din alocat</span>
                    <span><b className="num">{pct(v, sum.spent)}%</b>din total</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : <EmptyArt icon="pie-chart" title="Încă nu ai cheltuieli" text="Apasă „Cheltuială” și trece primul ban. Aici vezi pe ce se duc banii, pe categorii." />}
        {topCats.length > 0 && <button type="button" className="link" onClick={() => nav('categories')}>Toate categoriile <ChevronRight size={15} /></button>}
      </section>

      <section>
        <h2>Cele mai mari 3 cheltuieli din perioadă</h2>
        {top3.length ? (
          <div className="rows">{top3.map(t => <TxRow key={t.id} t={t} onOpen={openTx} />)}</div>
        ) : <p className="empty-line">Încă nimic de arătat.</p>}
        <button type="button" className="link" onClick={() => nav('history', { sort: 'amount' })}>Vezi mai multe <ChevronRight size={15} /></button>
      </section>
    </div>
  )
}
