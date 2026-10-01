import { describe, expect, it } from 'vitest'
import { pendingMessage } from '../test/fakes'
import { ApiError } from './api'
import { canChange, changeErrorMessage, EDIT_WINDOW_MS } from './edits'

describe('canChange', () => {
  const sentAt = Date.parse('2026-01-01T00:00:00Z')
  const sent = pendingMessage({
    sender_id: 'me',
    seq: 1,
    status: 'sent',
    created_at: new Date(sentAt).toISOString(),
  })

  it('allows my acked messages inside the edit window', () => {
    expect(canChange(sent, 'me', sentAt + EDIT_WINDOW_MS - 1)).toBe(true)
  })

  it('refuses after the window, for others’ messages, unacked ones, and deleted ones', () => {
    expect(canChange(sent, 'me', sentAt + EDIT_WINDOW_MS)).toBe(false)
    expect(canChange(sent, 'someone-else', sentAt)).toBe(false)
    expect(canChange({ ...sent, seq: null, status: 'sending' }, 'me', sentAt)).toBe(false)
    expect(canChange({ ...sent, deleted_at: '2026-01-01T00:01:00Z' }, 'me', sentAt)).toBe(false)
  })
})

describe('changeErrorMessage', () => {
  it('explains the edit window and already-deleted messages', () => {
    expect(changeErrorMessage(new ApiError(403, 'edit_window_expired'))).toBe(
      'too late: messages can only be changed for 15 minutes.',
    )
    expect(changeErrorMessage(new ApiError(409, 'message_deleted'))).toBe(
      'that message was already deleted.',
    )
  })

  it('falls back to a connection hint for anything else', () => {
    const fallback = 'couldn’t save the change. check your connection and try again.'
    expect(changeErrorMessage(new ApiError(404, 'message_not_found'))).toBe(fallback)
    expect(changeErrorMessage(new TypeError('Failed to fetch'))).toBe(fallback)
  })
})
