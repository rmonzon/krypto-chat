import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { inviteErrorMessage } from './invites'

describe('inviteErrorMessage', () => {
  it('explains invite errors and ignores anything else', () => {
    expect(inviteErrorMessage(new ApiError(410, 'invite_used'))).toBe(
      'That invite was already used.',
    )
    expect(inviteErrorMessage(new ApiError(500, 'internal_error'))).toBeUndefined()
    expect(inviteErrorMessage(new TypeError('Failed to fetch'))).toBeUndefined()
  })
})
