import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../lib/api'
import { inviteErrorMessage } from '../lib/invites'
import { supabase } from '../lib/supabase'
import { Brand } from '../ui/Brand'
import { Icon } from '../ui/Icon'
import { MatrixRain } from '../ui/MatrixRain'

// Sign-up is invite-only: first the code, then (once it checks out) the
// account and profile details together.
type Step = 'sign-in' | 'code' | 'details'

/** Checks an invite code (and optionally a username) without an account. Returns the normalized code. */
async function checkInvite(code: string, username?: string) {
  const res = await api<{ code: string }>('/invites/check', {
    method: 'POST',
    body: JSON.stringify({ code, username }),
  })
  return res.code
}

export function AuthScreen() {
  const [step, setStep] = useState<Step>('sign-in')
  const [codeInput, setCodeInput] = useState('')
  // The validated, normalized code once the code step passes.
  const [code, setCode] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  function go(next: Step) {
    setStep(next)
    setError(null)
    setNotice(null)
  }

  function fail(message: string) {
    setError(message)
    setShaking(true)
    setTimeout(() => setShaking(false), 420)
  }

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await task()
    } catch (err) {
      fail(inviteErrorMessage(err) ?? 'Couldn’t reach the server. Try again.')
    }
    setBusy(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 'sign-in') {
      void run(async () => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) fail(error.message)
      })
    } else if (step === 'code') {
      void run(async () => {
        setCode(await checkInvite(codeInput))
        setStep('details')
      })
    } else if (code) {
      void run(async () => {
        // Re-check: the code may have expired or been used since, and the
        // username must be free. Nothing is reserved until the profile exists.
        await checkInvite(code, username)
        // Saved on the account, so the profile can be created on first sign-in,
        // even after confirming the email on another device.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { invite_code: code, username, display_name: displayName.trim() },
          },
        })
        if (error) return fail(error.message)
        // With email confirmation on, sign-up succeeds without a session.
        if (!data.session) {
          setStep('sign-in')
          setNotice('Check your email to confirm your account, then sign in.')
        }
      })
    }
  }

  const status: ReactNode = error ? (
    <span className="err">✕ {error}</span>
  ) : notice ? (
    <span className="ok">◢ {notice}</span>
  ) : busy ? (
    <span className="ok">
      ◢{' '}
      {step === 'sign-in'
        ? 'Unlocking vault…'
        : step === 'code'
          ? 'Checking invite…'
          : 'Creating vault…'}
    </span>
  ) : (
    <span>
      {step === 'sign-in'
        ? 'Vault locked · sign in to continue'
        : step === 'code'
          ? 'Invite-only · enter your code'
          : 'Invite accepted · set up your account'}
    </span>
  )

  return (
    <div className="screen lock-screen">
      <MatrixRain opacity={0.45} />
      <div className="lock-vapor" />
      <div className={'lock-core ' + (shaking ? 'bad' : busy ? 'busy' : '')}>
        <div className="lock-badge">
          <span className="lock-ring" />
          <Icon name={step === 'code' ? 'ticket' : 'lock'} size={30} />
        </div>
        <Brand size={1.5} />
        <div className="lock-status" role="status" aria-live="polite">
          {status}
        </div>

        <form className={'lock-form ' + (error ? 'bad' : '')} onSubmit={handleSubmit}>
          {step === 'code' && (
            <>
              <label className="field-label" htmlFor="auth-invite">
                Invite code
              </label>
              <div className="key-input">
                <Icon name="ticket" size={16} className="ki-lead" />
                <input
                  id="auth-invite"
                  className="invite-input"
                  placeholder="KC-XXXX-XXXX-XXXX"
                  required
                  autoFocus
                  maxLength={40}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="auth-invite-hint"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
              </div>
              <span className="field-hint" id="auth-invite-hint">
                kryptochat is invite-only. Ask someone already on it to share a code.
              </span>
            </>
          )}

          {step === 'details' && code && (
            <div className="invite-accepted">
              <Icon name="check2" size={14} />
              <span>{code}</span>
              <button type="button" className="kd-fill" onClick={() => go('code')}>
                change
              </button>
            </div>
          )}

          {step !== 'code' && (
            <>
              <label className="field-label" htmlFor="auth-email">
                {step === 'details' ? 'Email' : 'Identity'}
              </label>
              <div className="key-input">
                <Icon name="mail" size={16} className="ki-lead" />
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
                  placeholder={step === 'sign-in' ? 'enter password' : 'choose a password (6+ chars)'}
                  autoComplete={step === 'sign-in' ? 'current-password' : 'new-password'}
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
            </>
          )}

          {step === 'details' && (
            <>
              <label className="field-label" htmlFor="auth-username">
                Username
              </label>
              <div className="key-input">
                <span className="ki-lead ki-at" aria-hidden="true">
                  @
                </span>
                <input
                  id="auth-username"
                  placeholder="lowercase, digits, _"
                  required
                  spellCheck={false}
                  autoComplete="username"
                  pattern="[a-z0-9_]{3,30}"
                  title="3–30 characters: lowercase letters, numbers, underscore"
                  aria-describedby="auth-username-hint"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                />
              </div>
              <span className="field-hint" id="auth-username-hint">
                3–30 characters. Others find you by this, and it can’t be changed later.
              </span>

              <label className="field-label" htmlFor="auth-display-name">
                Display name
              </label>
              <div className="key-input">
                <Icon name="user" size={16} className="ki-lead" />
                <input
                  id="auth-display-name"
                  placeholder="how you appear to peers"
                  required
                  maxLength={60}
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </>
          )}

          <button type="submit" className="btn-primary lock-go" disabled={busy}>
            {busy ? (
              <span className="spin" />
            ) : (
              <Icon name={step === 'code' ? 'chevron' : 'shield'} size={16} />
            )}
            {step === 'sign-in' ? 'Decrypt vault' : step === 'code' ? 'Continue' : 'Create vault'}
          </button>
        </form>

        <button
          type="button"
          className="hint-chip"
          onClick={() => go(step === 'sign-in' ? 'code' : 'sign-in')}
        >
          <Icon name={step === 'sign-in' ? 'ticket' : 'unlock'} size={12} />
          {step === 'sign-in' ? (
            <>
              have an invite?&nbsp;<b>sign up</b>
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
