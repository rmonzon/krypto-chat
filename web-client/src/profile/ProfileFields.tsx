import { USERNAME_PATTERN } from '../lib/limits'
import { Icon } from '../ui/Icon'

type Props = {
  /** Prefixes the inputs' ids, so two forms can't collide. */
  idPrefix: string
  username: string
  displayName: string
  onUsernameChange: (username: string) => void
  onDisplayNameChange: (displayName: string) => void
  autoFocus?: boolean
}

/** Username and display name inputs, shared by sign-up and profile setup. */
export function ProfileFields({
  idPrefix,
  username,
  displayName,
  onUsernameChange,
  onDisplayNameChange,
  autoFocus,
}: Props) {
  return (
    <>
      <label className="field-label" htmlFor={`${idPrefix}-username`}>
        Username
      </label>
      <div className="key-input">
        <span className="ki-lead ki-at" aria-hidden="true">
          @
        </span>
        <input
          id={`${idPrefix}-username`}
          placeholder="lowercase, digits, _"
          required
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="username"
          pattern={USERNAME_PATTERN}
          title="3–30 characters: lowercase letters, numbers, underscore"
          aria-describedby={`${idPrefix}-username-hint`}
          value={username}
          onChange={(e) => onUsernameChange(e.target.value.toLowerCase())}
        />
      </div>
      <span className="field-hint" id={`${idPrefix}-username-hint`}>
        3–30 characters. Others find you by this, and it can’t be changed later.
      </span>

      <label className="field-label" htmlFor={`${idPrefix}-display-name`}>
        Display name
      </label>
      <div className="key-input">
        <Icon name="user" size={16} className="ki-lead" />
        <input
          id={`${idPrefix}-display-name`}
          placeholder="how you appear to peers"
          required
          maxLength={60}
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
        />
      </div>
    </>
  )
}
