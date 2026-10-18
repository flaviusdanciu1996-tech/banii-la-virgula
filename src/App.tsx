import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Home, PieChart, ReceiptText, Gem, User, ChevronLeft, Download, X } from 'lucide-react'
import { supabase, supabaseRepo, demoRepo, DEMO, type Repo } from './db.ts'
import { StoreProvider, useStore, type User as AppUser } from './store.tsx'
import { demoSeed, DEMO_USER } from './demo.ts'
import { useToast, Confetti } from './ui.tsx'
import { TxSheet, CategorySheet, AssetSheet } from './sheets.tsx'
import { HomeScreen } from './screens/Home.tsx'
import { ExpensesTab, HistoryScreen, CategoriesScreen } from './screens/Expenses.tsx'
import { StatsScreen } from './screens/Stats.tsx'
import { AvereScreen } from './screens/Avere.tsx'
import { AccountScreen, FinanteScreen, FamilyScreen, AspectScreen, AccountSettingsScreen, AboutScreen } from './screens/Account.tsx'
import { AuthScreen, NewPasswordScreen } from './screens/Auth.tsx'
import { RecurringScreen, RecurringSheet, GoalSheet } from './screens/Plans.tsx'
import { ReminderScreen } from './screens/Reminder.tsx'
import { summarize, recordDays, streak } from './lib/calc.ts'
import { periodFor, shiftPeriod, todayIso, type Period } from './lib/period.ts'
import type { Tx, Category, Asset, AssetSection, Kind, Recurring, Goal } from './lib/types.ts'

export type Nav = (route: string, params?: Record<string, string>) => void
type Tab = 'home' | 'stats' | 'exp' | 'avere' | 'cont'
type Theme = 'system' | 'light' | 'dark'

const SUB_TITLES: Record<string, string> = {
  history: 'Istoric', categories: 'Pe categorii', finante: 'Finanțe', familie: 'Familia mea',
  aspect: 'Aspect', setari: 'Setări cont', despre: 'Despre aplicație', recurente: 'Plăți recurente', notificari: 'Notificări și citate',
}

function readTheme(): Theme {
  try { return (localStorage.getItem('theme') as Theme) || 'dark' } catch { return 'dark' }
}

export default function App() {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const [user, setUser] = useState<AppUser | null>(DEMO ? DEMO_USER : null)
  const [checking, setChecking] = useState(!DEMO)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    if (!supabase) { setChecking(false); return }
    const toUser = (u: any): AppUser => ({ id: u.id, email: u.email || '', name: u.user_metadata?.name || '' })
    supabase.auth.getSession().then(({ data }) => { setUser(data.session ? toUser(data.session.user) : null); setChecking(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true)
      setUser(session ? toUser(session.user) : null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const repo: Repo | null = useMemo(() => (DEMO ? demoRepo(demoSeed()) : supabase ? supabaseRepo(supabase) : null), [])

  if (!repo) return <div className="center-screen"><div className="card form"><h1>Lipsește configurarea</h1><p>Aplicația nu are încă adresa bazei de date. Deschide <b>?demo</b> pentru o previzualizare.</p></div></div>
  if (checking) return <div className="center-screen"><div className="spinner" aria-label="Se încarcă" /></div>
  if (recovery) return <NewPasswordScreen onDone={() => setRecovery(false)} />
  if (!user) return <AuthScreen />

  return (
    <StoreProvider key={user.id} repo={repo} user={user}>
      <Shell theme={theme} setTheme={setThemeState} />
    </StoreProvider>
  )
}

function Shell({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const st = useStore()
  const [toast, notify] = useToast()
  const [tab, setTab] = useState<Tab>('home')
  const [sub, setSub] = useState<{ id: string; params?: Record<string, string> } | null>(null)
  const [anchor, setAnchor] = useState<string | undefined>()
  const [scope, setScope] = useState<'all' | 'me'>('all')
  const [offset, setOffset] = useState(0)
  const [txSheet, setTxSheet] = useState<{ tx?: Tx; kind?: Kind; template?: Partial<Tx> } | null>(null)
  const [recSheet, setRecSheet] = useState<{ r?: Recurring } | null>(null)
  const [goalSheet, setGoalSheet] = useState<{ g?: Goal; add?: boolean } | null>(null)
  const [party, setParty] = useState<string | null>(null)
  const celebrate = useCallback((m: string) => setParty(m), [])
  const [catSheet, setCatSheet] = useState<{ cat?: Category; kind?: Kind } | null>(null)
  const [assetSheet, setAssetSheet] = useState<{ a?: Asset; section?: AssetSection; quick?: boolean } | null>(null)
  const [joinCode, setJoinCode] = useState<string | undefined>()

  const period: Period = useMemo(() => shiftPeriod(periodFor(todayIso(), st.settings.payday), offset, st.settings.payday), [offset, st.settings.payday])

  // Android back button closes sheets / sub-screens instead of leaving the app.
  const skipPop = useRef(false)
  useEffect(() => {
    const onPop = () => {
      if (skipPop.current) { skipPop.current = false; return }
      if (txSheet || catSheet || assetSheet || recSheet || goalSheet) { setTxSheet(null); setCatSheet(null); setAssetSheet(null); setRecSheet(null); setGoalSheet(null); return }
      setSub(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [txSheet, catSheet, assetSheet, recSheet, goalSheet])
  const pushState = () => { try { history.pushState({ x: 1 }, '') } catch { /* ignore */ } }

  // Invite links: …#join-CODE
  useEffect(() => {
    const m = location.hash.match(/^#join-([A-Za-z0-9]+)/)
    if (m) { setJoinCode(m[1].toUpperCase()); setTab('cont'); setSub({ id: 'familie' }) }
  }, [])

  const nav: Nav = useCallback((route, params) => {
    window.scrollTo(0, 0)
    if (route.startsWith('tab:')) {
      const [t, a] = route.slice(4).split('#')
      setSub(null); setTab(t as Tab); setAnchor(a)
      return
    }
    pushState()
    setSub({ id: route, params })
  }, [])

  const openTx = (tx?: Tx, kind?: Kind, template?: Partial<Tx>) => { pushState(); setTxSheet({ tx, kind, template }) }
  const openRecurring = (r?: Recurring) => { pushState(); setRecSheet({ r }) }
  const openGoal = (g?: Goal, add?: boolean) => { pushState(); setGoalSheet({ g, add }) }

  // Celebrate a finished period that ended under budget (once per period).
  useEffect(() => {
    if (!st.ready || st.error) return
    const prev = shiftPeriod(periodFor(todayIso(), st.settings.payday), -1, st.settings.payday)
    const sum = summarize(st.txs, st.categories, st.settings, prev, todayIso())
    if (sum.totalBudget > 0 && sum.txs.length > 3 && sum.spent <= sum.totalBudget) {
      const key = 'celebrated-' + prev.start
      try { if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setParty('Ai încheiat luna trecută sub buget! 🎉') } } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.ready])

  // Celebrate every 7 days in a row of recorded entries.
  const afterSave = () => {
    const days = recordDays(st.txs, st.user.id)
    const today = todayIso()
    if (!days.includes(today)) days.push(today)
    const n = streak(days, today)
    if (n > 0 && n % 7 === 0) {
      const key = 'streak-party-' + today
      try { if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setParty(`${n} zile la rând! 🔥 +10 puncte`) } } catch { /* ignore */ }
    }
  }
  const openCategory = (cat?: Category, kind?: Kind) => { pushState(); setCatSheet({ cat, kind }) }
  const openAsset = (a?: Asset, section?: AssetSection, quick?: boolean) => { pushState(); setAssetSheet({ a, section, quick }) }
  const closeSheet = (fn: () => void) => () => { fn(); try { if (history.state?.x) { skipPop.current = true; history.back() } } catch { /* ignore */ } }

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    else location.search = ''
  }

  if (!st.ready) return <div className="center-screen"><div className="spinner" aria-label="Se încarcă" /></div>
  if (st.error) return (
    <div className="center-screen"><div className="card form">
      <h1>Nu s-au putut încărca datele</h1>
      <p className="err">{st.error}</p>
      <p className="muted small">Verifică internetul. Dacă e prima pornire, scriptul bazei de date trebuie rulat în Supabase.</p>
      <button type="button" className="primary" onClick={() => st.reload()}>Încearcă din nou</button>
      <button type="button" className="ghost-btn" onClick={logout}>Deconectare</button>
    </div></div>
  )

  let body: JSX.Element
  if (sub) {
    const back = () => { try { history.back() } catch { setSub(null) } }
    let inner: JSX.Element
    switch (sub.id) {
      case 'history': inner = <HistoryScreen openTx={openTx} initial={sub.params} />; break
      case 'categories': inner = <CategoriesScreen period={period} nav={nav} />; break
      case 'finante': inner = <FinanteScreen openCategory={openCategory} notify={notify} />; break
      case 'familie': inner = <FamilyScreen notify={notify} joinCode={joinCode} />; break
      case 'aspect': inner = <AspectScreen theme={theme} setTheme={setTheme} />; break
      case 'setari': inner = <AccountSettingsScreen notify={notify} />; break
      case 'recurente': inner = <RecurringScreen openRecurring={openRecurring} />; break
      case 'notificari': inner = <ReminderScreen notify={notify} />; break
      default: inner = <AboutScreen />
    }
    body = (
      <>
        <header className="subbar">
          <button type="button" className="icon-btn" aria-label="Înapoi" onClick={back}><ChevronLeft size={20} /></button>
          <h1>{SUB_TITLES[sub.id] || ''}</h1>
          <span style={{ width: 38 }} />
        </header>
        {inner}
      </>
    )
  } else {
    body = tab === 'home' ? <HomeScreen nav={nav} period={period} setPeriod={n => setOffset(o => o + n)} scope={scope} setScope={setScope} openTx={openTx} openRecurring={openRecurring} openGoal={openGoal} />
      : tab === 'stats' ? <StatsScreen period={period} anchor={anchor} />
      : tab === 'exp' ? <ExpensesTab nav={nav} openTx={openTx} />
      : tab === 'avere' ? <AvereScreen scope={scope} openAsset={openAsset} openGoal={openGoal} />
      : <AccountScreen nav={nav} onLogout={logout} />
  }

  const tabs: [Tab, typeof Home, string][] = [['home', Home, 'Acasă'], ['stats', PieChart, 'Statistici'], ['exp', ReceiptText, 'Cheltuieli'], ['avere', Gem, 'Avere'], ['cont', User, 'Cont']]

  return (
    <div className="app">
      {DEMO && <div className="demo-bar">Previzualizare cu date de exemplu</div>}
      <main className="wrap">
        <InstallHint />
        {body}
      </main>
      <nav className="tabbar" aria-label="Meniu principal">
        {tabs.map(([id, I, label]) => (
          <button key={id} type="button" aria-current={!sub && tab === id ? 'page' : undefined}
            onClick={() => { setSub(null); setAnchor(undefined); setTab(id); window.scrollTo(0, 0) }}>
            <I size={21} /><span>{label}</span>
          </button>
        ))}
      </nav>
      {txSheet && <TxSheet tx={txSheet.tx} kind={txSheet.kind} template={txSheet.template} notify={notify} onSaved={afterSave} onClose={closeSheet(() => setTxSheet(null))} />}
      {recSheet && <RecurringSheet rec={recSheet.r} notify={notify} onClose={closeSheet(() => setRecSheet(null))} />}
      {goalSheet && <GoalSheet goal={goalSheet.g} addMode={goalSheet.add} notify={notify} celebrate={celebrate} onClose={closeSheet(() => setGoalSheet(null))} />}
      {party && <><Confetti onDone={() => setTimeout(() => setParty(null), 800)} /><div className="celebrate" role="status">{party}</div></>}
      {catSheet && <CategorySheet cat={catSheet.cat} kind={catSheet.kind} notify={notify} onClose={closeSheet(() => setCatSheet(null))} />}
      {assetSheet && <AssetSheet asset={assetSheet.a} section={assetSheet.section} quick={assetSheet.quick} notify={notify} onClose={closeSheet(() => setAssetSheet(null))} />}
      {toast}
    </div>
  )
}

function InstallHint() {
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone)
  const [hidden, setHidden] = useState(() => { try { return !!localStorage.getItem('install-hint-off') } catch { return false } })
  const [prompt, setPrompt] = useState<any>(null)
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (standalone || hidden || DEMO) return null
  const off = () => { setHidden(true); try { localStorage.setItem('install-hint-off', '1') } catch { /* ignore */ } }
  return (
    <div className="install">
      <Download size={18} />
      <div>
        <b>Instalează aplicația</b>
        <p>{prompt ? 'Pune-o pe ecranul telefonului și se deschide pe tot ecranul.' : 'În Chrome: ⋮ → „Instalează aplicația” (sau „Adaugă pe ecranul de pornire”).'}</p>
        {prompt && <button type="button" className="primary small" onClick={async () => { prompt.prompt(); await prompt.userChoice; off() }}>Instalează</button>}
      </div>
      <button type="button" className="icon-btn" aria-label="Ascunde" onClick={off}><X size={16} /></button>
    </div>
  )
}
