import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Brand } from '../ui/Brand'
import { Icon } from '../ui/Icon'
import { MatrixRain } from '../ui/MatrixRain'

type Mode = 'sign-in' | 'sign-up'

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    const fail = (message: string) => {
      setError(message)
      setShaking(true)
      setTimeout(() => setShaking(false), 420)
    }

    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) fail(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) fail(error.message)
      // With email confirmation on, sign-up succeeds without a session.
      else if (!data.session) setNotice('Check your email to confirm your account, then sign in.')
    }
    setBusy(false)
  }

  function toggleMode() {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
    setError(null)
    setNotice(null)
  }

  const coreState = shaking ? 'bad' : busy ? 'busy' : ''

  return (
    <div className="screen lock-screen">
      <MatrixRain opacity={0.45} />
      <div className="lock-vapor" />
      <div className={'lock-core ' + coreState}>
        <div className="lock-badge">
          <span className="lock-ring" />
          <Icon name="lock" size={30} />
        </div>
        <Brand size={1.5} />
        <div className="lock-status" role="status" aria-live="polite">
          {error ? (
            <span className="err">✕ {error}</span>
          ) : notice ? (
            <span className="ok">◢ {notice}</span>
          ) : busy ? (
            <span className="ok">◢ {mode === 'sign-in' ? 'Unlocking vault…' : 'Creating vault…'}</span>
          ) : (
            <span>{mode === 'sign-in' ? 'Vault locked · sign in to continue' : 'New vault · create an account'}</span>
          )}
        </div>

        <form className={'lock-form ' + (error ? 'bad' : '')} onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="auth-email">
            Identity
          </label>
          <div className="key-input">
            <Icon name="user" size={16} className="ki-lead" />
            <input
              id="auth-email"
              type="email"
              placeholder="email address"
              autoComplete="email"
              spellCheck={false}
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <label className="field-label" htmlFor="auth-password">
            Master key
          </label>
          <div className="key-input">
            <Icon name="key" size={16} className="ki-lead" />
            <input
              id="auth-password"
              type={showPassword ? 'text' : 'password'}
              placeholder={mode === 'sign-in' ? 'enter password' : 'choose a password (6+ chars)'}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              spellCheck={false}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="ki-eye"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              <Icon name="eye" size={16} />
            </button>
          </div>

          <button type="submit" className="btn-primary lock-go" disabled={busy}>
            {busy ? <span className="spin" /> : <Icon name="shield" size={16} />}
            {mode === 'sign-in' ? 'Decrypt vault' : 'Create vault'}
          </button>
        </form>

        <button type="button" className="hint-chip" onClick={toggleMode}>
          <Icon name={mode === 'sign-in' ? 'userPlus' : 'unlock'} size={12} />
          {mode === 'sign-in' ? (
            <>
              no account?&nbsp;<b>sign up</b>
            </>
          ) : (
            <>
              have an account?&nbsp;<b>sign in</b>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
