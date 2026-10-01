import { ApiError } from './api'

const MESSAGES: Record<string, string> = {
  invite_required: 'kryptochat is invite-only. Enter the code someone shared with you.',
  invalid_code: 'That doesn’t look like an invite code.',
  invite_not_found: 'No invite with that code.',
  invite_used: 'That invite was already used.',
  invite_expired: 'That invite expired. Ask for a new one.',
  own_invite: 'That’s your own invite. Share it with someone else.',
  signup_only_invite: 'That code is for signing up new users, not for connecting.',
  username_taken: 'That username is taken.',
  invalid_username: 'Usernames are 3–30 lowercase letters, digits or _.',
}

/**
 * User-facing text for an error from the invite and sign-up endpoints
 * (/invites/*, POST /profiles), or undefined for anything else.
 */
export function inviteErrorMessage(err: unknown): string | undefined {
  return err instanceof ApiError ? MESSAGES[err.code] : undefined
}
