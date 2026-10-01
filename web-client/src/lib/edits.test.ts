import { describe, expect, it } from 'vitest'
import { pendingMessage } from '../test/fakes'
import { canChange, EDIT_WINDOW_MS } from './edits'

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
