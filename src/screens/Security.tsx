import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ShieldCheck, Fingerprint, Delete, Copy, KeyRound, LogOut, Smartphone } from 'lucide-react'
import { supabase, DEMO } from '../db.ts'

/* ================= 2FA (authenticator code) =================
   Once a code app is linked, the database only opens for a session confirmed with the 6-digit code
   (restrictive RLS policy public.aal_ok()). Here the app asks for it: setup on first use, then the code at every login. */

type MfaState = 'checking' | 'ok' | 'verify' | 'enroll' | 'error'

export function MfaGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MfaState>(DEMO || !supabase ? 'ok' : 'checking')
  const [err, setErr] = useState('')

  const check = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) { setErr(error?.message || 'Nu am putut verifica sesiunea.'); setState('error'); return }
    if (data.currentLevel === 'aal2') setState('ok')
    else if (data.nextLevel === 'aal2') setState('verify')
    else setState('enroll')
  }, [])

  useEffect(() => { if (state === 'checking') check() }, [state, check])

  if (state === 'ok') return <>{children}</>
  if (state === 'checking') return <div className="center-screen"><div className="spinner" aria-label="Se încarcă" /></div>
  if (state === 'error') return (
    <div className="center-screen auth"><div className="card form">
      <h1>Verificare eșuată</h1>
      <p className="err">{err}</p>
      <button type="button" className="primary" onClick={() => setState('checking')}>Încearcă din nou</button>
      <SignOutLink />
    </div></div>
  )
  if (state === 'verify') return <MfaVerify onOk={() => setState('ok')} />
  return <MfaEnroll onOk={() => setState('ok')} />
}

function SignOutLink() {
  return <button type="button" className="inline-link" onClick={() => supabase?.auth.signOut()}>Ieși din cont</button>
}

function CodeField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">Codul de 6 cifre
      <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus={autoFocus}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </label>
  )
}

const mfaErr = (m: string) => /invalid|expired/i.test(m) ? 'Cod greșit sau expirat. Ia codul nou din aplicație.' : m

function MfaVerify({ onOk }: { onOk: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function go(e?: React.FormEvent) {
    e?.preventDefault()
    if (!supabase || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      const { data: f } = await supabase.auth.mfa.listFactors()
      const factor = f?.totp?.[0]
      if (!factor) { setErr('Nu găsesc aplicația de coduri legată de cont.'); return }
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (error) { setErr(mfaErr(error.message)); setCode(''); return }
      onOk()
    } finally { setBusy(false) }
  }
  useEffect(() => { if (code.length === 6) go() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="center-screen auth">
      <form className="card form" onSubmit={go} noValidate>
        <div className="sec-ic"><ShieldCheck size={30} /></div>
        <h1>Codul de siguranță</h1>
        <p className="muted">Deschide Google Authenticator și scrie codul de 6 cifre pentru „Banii la virgulă”.</p>
        <CodeField value={code} onChange={setCode} autoFocus />
        {err && <p className="err">{err}</p>}
        <button type="submit" className="primary" disabled={busy || code.length !== 6}>{busy ? 'Verific…' : 'Intră'}</button>
        <div className="auth-links"><SignOutLink /></div>
      </form>
    </div>
  )
}

function MfaEnroll({ onOk }: { onOk: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !supabase) return
    started.current = true
    ;(async () => {
      // Drop half-finished setups from earlier attempts, then start a fresh one.
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const x of list?.all ?? []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Telefon', issuer: 'Banii la virgulă' })
      if (error || !data) { setErr(error?.message || 'Nu am putut porni configurarea.'); return }
      setF({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri })
    })()
  }, [])

  async function go(e?: React.FormEvent) {
    e?.preventDefault()
    if (!supabase || !f || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code })
      if (error) { setErr(mfaErr(error.message)); setCode(''); return }
      onOk()
    } finally { setBusy(false) }
  }
  useEffect(() => { if (code.length === 6) go() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => { try { await navigator.clipboard.writeText(f!.secret); setCopied(true) } catch { /* ignore */ } }
  return (
    <div className="center-screen auth">
      <form className="card form" onSubmit={go} noValidate>
        <div className="sec-ic"><ShieldCheck size={30} /></div>
        <h1>Protejează-ți contul</h1>
        <p className="muted">Pe lângă parolă, aplicația îți va cere un cod de 6 cifre din Google Authenticator. Fără telefonul tău, nimeni nu-ți poate vedea datele, chiar dacă ar afla parola.</p>
        <ol className="sec-steps">
          <li>Instalează <b>Google Authenticator</b> din Magazin Play și intră cu contul Google (așa codurile au copie de rezervă).</li>
          <li>Apasă butonul de mai jos. Dacă nu se deschide, în Authenticator alege <b>+ → Introdu o cheie</b> și lipește cheia.</li>
          <li>Scrie aici codul de 6 cifre apărut.</li>
        </ol>
        {!f && !err && <div className="spinner" aria-label="Se pregătește" />}
        {f && <>
          <a className="primary" href={f.uri}><Smartphone size={18} />Adaugă în Authenticator</a>
          <div className="sec-key">
            <code>{f.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <button type="button" className="ghost-btn" onClick={copy}><Copy size={16} />{copied ? 'Copiată' : 'Copiază cheia'}</button>
          </div>
          <details className="sec-qr"><summary>Am alt telefon: arată codul QR</summary><img src={f.qr} alt="Cod QR pentru Authenticator" width="180" height="180" /></details>
          <CodeField value={code} onChange={setCode} />
        </>}
        {err && <p className="err">{err}</p>}
        {f && <button type="submit" className="primary" disabled={busy || code.length !== 6}>{busy ? 'Verific…' : 'Activează'}</button>}
        <div className="auth-links"><SignOutLink /></div>
      </form>
    </div>
  )
}

/* ================= App lock (PIN or fingerprint) =================
   A second wall on the phone itself: the app opens only after the PIN or fingerprint,
   at every start and after 5 minutes in the background. Stored only on this phone (salted PBKDF2). */

const LOCK_AFTER_MS = 5 * 60 * 1000
const MAX_FAILS = 5
/** Preview only: ?demo&lock shows the lock screens with sample data. */
const NO_LOCK = DEMO && !/[?&]lock\b/.test(location.search)
type LockCfg = { salt: string; hash: string; len: number; cred?: string }

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const lockKey = (uid: string) => 'lock-' + uid
const failKey = (uid: string) => 'lock-fails-' + uid

function readCfg(uid: string): LockCfg | null {
  try { const s = localStorage.getItem(lockKey(uid)); return s ? JSON.parse(s) : null } catch { return null }
}
function writeCfg(uid: string, c: LockCfg | null) {
  try { if (c) localStorage.setItem(lockKey(uid), JSON.stringify(c)); else localStorage.removeItem(lockKey(uid)) } catch { /* ignore */ }
}
function fails(uid: string): number { try { return Number(localStorage.getItem(failKey(uid)) || 0) } catch { return 0 } }
function setFails(uid: string, n: number) { try { if (n) localStorage.setItem(failKey(uid), String(n)); else localStorage.removeItem(failKey(uid)) } catch { /* ignore */ } }

async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 210000, hash: 'SHA-256' }, key, 256)
  return b64(bits)
}
async function makeCfg(pin: string, cred?: string): Promise<LockCfg> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, hash: await hashPin(pin, salt), len: pin.length, cred }
}

export async function bioAvailable(): Promise<boolean> {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}
async function bioRegister(email: string): Promise<string | null> {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Banii la virgulă', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email || 'utilizator', displayName: email || 'Banii la virgulă' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    } }) as PublicKeyCredential | null
    return cred ? b64(cred.rawId) : null
  } catch { return null }
}
async function bioCheck(cred: string): Promise<boolean> {
  try {
    const r = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(cred) }],
      userVerification: 'required', timeout: 60000, rpId: location.hostname,
    } })
    return !!r
  } catch { return false }
}

function forgetAndSignOut(uid: string) {
  writeCfg(uid, null); setFails(uid, 0)
  supabase?.auth.signOut()
}

export function AppLock({ uid, email, children }: { uid: string; email: string; children: ReactNode }) {
  const [cfg, setCfg] = useState<LockCfg | null>(() => (NO_LOCK ? null : readCfg(uid)))
  const [locked, setLocked] = useState(() => !NO_LOCK && !!readCfg(uid))
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    if (NO_LOCK) return
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS && readCfg(uid)) setLocked(true)
      if (document.visibilityState === 'visible') hiddenAt.current = null
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [uid])

  if (NO_LOCK) return <>{children}</>
  if (!cfg) return <LockSetup email={email} onDone={c => { writeCfg(uid, c); setCfg(c); setLocked(false) }} />
  return (
    <>
      <div aria-hidden={locked || undefined} style={locked ? { visibility: 'hidden' } : undefined}>{children}</div>
      {locked && <LockScreen uid={uid} cfg={cfg} onOpen={() => setLocked(false)} />}
    </>
  )
}

function PinPad({ len, value, onChange, disabled }: { len: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const press = (d: string) => { if (!disabled && value.length < len) onChange(value + d) }
  return (
    <div className="pin">
      <div className="pin-dots" aria-label={`${value.length} din ${len} cifre`}>
        {Array.from({ length: len }, (_, i) => <span key={i} className={i < value.length ? 'on' : ''} />)}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>{d}</button>)}
        <span />
        <button type="button" onClick={() => press('0')} disabled={disabled}>0</button>
        <button type="button" aria-label="Șterge o cifră" onClick={() => onChange(value.slice(0, -1))} disabled={disabled}><Delete size={22} /></button>
      </div>
    </div>
  )
}

function LockScreen({ uid, cfg, onOpen }: { uid: string; cfg: LockCfg; onOpen: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const triedBio = useRef(false)

  const tryBio = useCallback(async () => {
    if (!cfg.cred) return
    if (await bioCheck(cfg.cred)) { setFails(uid, 0); onOpen() }
  }, [cfg.cred, uid, onOpen])

  useEffect(() => { if (!triedBio.current && cfg.cred) { triedBio.current = true; tryBio() } }, [cfg.cred, tryBio])

  useEffect(() => {
    if (pin.length !== cfg.len) return
    setBusy(true)
    hashPin(pin, cfg.salt).then(h => {
      if (h === cfg.hash) { setFails(uid, 0); onOpen(); return }
      const n = fails(uid) + 1
      setFails(uid, n)
      if (n >= MAX_FAILS) { forgetAndSignOut(uid); return }
      setErr(`PIN greșit. Mai ai ${MAX_FAILS - n} ${MAX_FAILS - n === 1 ? 'încercare' : 'încercări'}, apoi ieși din cont.`)
      setPin('')
    }).finally(() => setBusy(false))
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Aplicația e blocată">
      <div className="lock-in">
        <img src={import.meta.env.BASE_URL + 'icon-192.png'} alt="" width="56" height="56" />
        <h1>Banii la virgulă</h1>
        <p className="muted">Scrie PIN-ul{cfg.cred ? ' sau folosește amprenta' : ''}</p>
        <PinPad len={cfg.len} value={pin} onChange={v => { setErr(''); setPin(v) }} disabled={busy} />
        {err && <p className="err center">{err}</p>}
        {cfg.cred && <button type="button" className="ghost-btn" onClick={tryBio}><Fingerprint size={20} />Amprentă</button>}
        <button type="button" className="inline-link" onClick={() => forgetAndSignOut(uid)}>Am uitat PIN-ul (ies din cont)</button>
      </div>
    </div>
  )
}

function LockSetup({ email, onDone, onCancel, keepCred }: { email: string; onDone: (c: LockCfg) => void; onCancel?: () => void; keepCred?: string }) {
  const [len, setLen] = useState(6)
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [bioStep, setBioStep] = useState<string | null>(null)
  const [canBio, setCanBio] = useState(false)
  useEffect(() => { bioAvailable().then(setCanBio) }, [])

  useEffect(() => {
    if (pin.length !== len) return
    if (first === null) {
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) { setErr('Alege un PIN mai greu de ghicit (nu cifre la rând sau la fel).'); setPin(''); return }
      setFirst(pin); setPin(''); setErr('')
    } else if (pin === first) {
      if (canBio && !keepCred) setBioStep(pin)
      else makeCfg(pin, keepCred).then(onDone)
    } else { setErr('PIN-urile nu se potrivesc. Mai încearcă o dată.'); setFirst(null); setPin('') }
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (bioStep) return (
    <div className="lock-screen"><div className="lock-in">
      <div className="sec-ic"><Fingerprint size={34} /></div>
      <h1>Și cu amprenta?</h1>
      <p className="muted">Deschizi aplicația mai repede cu amprenta. PIN-ul rămâne pentru rezervă.</p>
      <button type="button" className="primary" onClick={async () => {
        const cred = await bioRegister(email)
        if (!cred) { setErr('Amprenta nu s-a putut activa. Poți încerca mai târziu din Cont → Securitate.') }
        onDone(await makeCfg(bioStep, cred ?? undefined))
      }}><Fingerprint size={18} />Activează amprenta</button>
      {err && <p className="err center">{err}</p>}
      <button type="button" className="ghost-btn" onClick={async () => onDone(await makeCfg(bioStep))}>Doar PIN</button>
    </div></div>
  )

  return (
    <div className="lock-screen"><div className="lock-in">
      <div className="sec-ic"><KeyRound size={30} /></div>
      <h1>{first === null ? 'Alege un PIN' : 'Scrie PIN-ul din nou'}</h1>
      <p className="muted">{first === null ? 'Aplicația se va bloca la fiecare pornire și după 5 minute în fundal.' : 'Ca să fim siguri că l-ai ținut minte.'}</p>
      {first === null && <div className="pin-len">{[4, 6].map(n => <button key={n} type="button" className="chip" aria-pressed={len === n} onClick={() => { setLen(n); setPin('') }}>{n} cifre</button>)}</div>}
      <PinPad len={len} value={pin} onChange={v => { setErr(''); setPin(v) }} />
      {err && <p className="err center">{err}</p>}
      {onCancel && <button type="button" className="inline-link" onClick={onCancel}>Renunță</button>}
    </div></div>
  )
}

/* ================= Cont → Securitate ================= */

export function SecurityScreen({ uid, email, notify }: { uid: string; email: string; notify: (m: string) => void }) {
  const [cfg, setCfg] = useState<LockCfg | null>(() => readCfg(uid))
  const [factor, setFactor] = useState<{ created: string } | null | undefined>(undefined)
  const [canBio, setCanBio] = useState(false)
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    bioAvailable().then(setCanBio)
    if (!supabase || DEMO) { setFactor(null); return }
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const f = data?.totp?.[0]
      setFactor(f ? { created: f.created_at } : null)
    })
  }, [])

  const save = (c: LockCfg | null) => { writeCfg(uid, c); setCfg(c) }

  if (changing) return <LockSetup email={email} keepCred={cfg?.cred} onCancel={() => setChanging(false)} onDone={c => { save(c); setChanging(false); notify('PIN schimbat') }} />

  return (
    <div className="screen">
      <section className="card">
        <h2><ShieldCheck size={18} /> Cod de siguranță (2FA)</h2>
        {factor === undefined ? <p className="muted small">Verific…</p>
          : factor ? <p><span className="ok">Activ</span> din {new Date(factor.created).toLocaleDateString('ro-RO')}. La fiecare intrare în cont îți cer codul din Google Authenticator, iar datele nu se deschid fără el.</p>
          : <p className="muted">Nu e activ{DEMO ? ' în previzualizare' : ''}.</p>}
        <p className="muted small">Dacă pierzi telefonul: cu Google Authenticator legat de contul Google, codurile vin înapoi pe telefonul nou. Altfel, scrie-mi și îl resetez din baza de date.</p>
      </section>

      <section className="card">
        <h2><KeyRound size={18} /> Blocarea aplicației</h2>
        <p className="muted small">Pe acest telefon: la fiecare pornire și după 5 minute în fundal. 5 PIN-uri greșite = ieșire din cont.</p>
        <button type="button" className="ghost-btn" onClick={() => setChanging(true)}>Schimbă PIN-ul</button>
        {canBio && (cfg?.cred
          ? <button type="button" className="ghost-btn" onClick={() => { if (cfg) { save({ ...cfg, cred: undefined }); notify('Amprenta e oprită') } }}><Fingerprint size={18} />Oprește amprenta</button>
          : <button type="button" className="ghost-btn" onClick={async () => {
              const cred = await bioRegister(email)
              if (cred && cfg) { save({ ...cfg, cred }); notify('Amprenta e activă') } else notify('Amprenta nu s-a putut activa')
            }}><Fingerprint size={18} />Activează amprenta</button>)}
      </section>

      <section className="card">
        <h2><LogOut size={18} /> Alte dispozitive</h2>
        <p className="muted small">Închide contul pe orice alt telefon sau calculator unde ai intrat vreodată. Aici rămâi conectat.</p>
        <button type="button" className="ghost-btn" onClick={async () => {
          if (!supabase || DEMO) return
          const { error } = await supabase.auth.signOut({ scope: 'others' })
          notify(error ? 'Nu a mers: ' + error.message : 'Gata, celelalte dispozitive sunt deconectate')
        }}>Deconectează celelalte dispozitive</button>
      </section>
    </div>
  )
}
