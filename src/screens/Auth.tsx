import { useState } from 'react'
import { supabase } from '../db.ts'

type Mode = 'login' | 'signup' | 'reset'

const RO: Record<string, string> = {
  'Invalid login credentials': 'Email sau parolă greșită.',
  'Email not confirmed': 'Confirmă întâi emailul: apasă linkul primit pe mail.',
  'User already registered': 'Există deja un cont cu acest email. Intră în cont.',
}
const tr = (m: string) => RO[m] || m

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const redirect = location.origin + location.pathname

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErr(''); setMsg('')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Scrie un email valid.')
    if (mode !== 'reset' && pw.length < 8) return setErr('Parola trebuie să aibă cel puțin 8 caractere.')
    if (mode === 'signup' && !name.trim()) return setErr('Scrie-ți numele.')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (error) setErr(tr(error.message))
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { name: name.trim() }, emailRedirectTo: redirect } })
        if (error) setErr(tr(error.message))
        else if (!data.session) setMsg('Ți-am trimis un email. Apasă linkul din el ca să-ți activezi contul, apoi intră aici.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect })
        if (error) setErr(tr(error.message)); else setMsg('Dacă există un cont cu acest email, ai primit un link pentru parolă nouă.')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="center-screen auth">
      <form className="card form" onSubmit={submit} noValidate>
        <div className="brand"><img src={import.meta.env.BASE_URL + 'icon-192.png'} alt="" width="44" height="44" /><h1>Banii la virgulă</h1></div>
        <p className="muted">{mode === 'login' ? 'Intră în contul tău' : mode === 'signup' ? 'Creează-ți contul' : 'Resetează parola'}</p>
        {mode === 'signup' && <label className="field">Nume<input id="a-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
        <label className="field">Email<input id="a-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value.trim())} /></label>
        {mode !== 'reset' && <label className="field">Parolă<input id="a-pw" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={e => setPw(e.target.value)} /></label>}
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Așteaptă…' : mode === 'login' ? 'Intră' : mode === 'signup' ? 'Creează cont' : 'Trimite linkul'}</button>
        <div className="auth-links">
          {mode !== 'login' && <button type="button" className="inline-link" onClick={() => setMode('login')}>Am deja cont</button>}
          {mode !== 'signup' && <button type="button" className="inline-link" onClick={() => setMode('signup')}>Cont nou</button>}
          {mode !== 'reset' && <button type="button" className="inline-link" onClick={() => setMode('reset')}>Am uitat parola</button>}
        </div>
      </form>
    </div>
  )
}

export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Parola trebuie să aibă cel puțin 8 caractere.')
    const { error } = await supabase!.auth.updateUser({ password: pw })
    if (error) return setErr(tr(error.message))
    onDone()
  }
  return (
    <div className="center-screen auth">
      <form className="card form" onSubmit={save} noValidate>
        <h1>Parolă nouă</h1>
        <label className="field">Parolă nouă<input id="np-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button type="submit" className="primary">Salvează</button>
      </form>
    </div>
  )
}
