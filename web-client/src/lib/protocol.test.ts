// web-client and api-server are separate projects, so the values both rely
// on are written out in each. This imports the server's (a dependency-free
// module) and checks the client's copies still agree.
import { describe, expect, it } from 'vitest'
import * as server from '../../../api-server/src/protocol.ts'
import { EDIT_WINDOW_MS } from './edits'
import { TTL_NOTICE_CONTENT_TYPE, TTL_OPTIONS } from './expiry'
import { MAX_BODY_LENGTH, USERNAME_PATTERN } from './limits'

describe('protocol values shared with api-server', () => {
  it('match', () => {
    expect(EDIT_WINDOW_MS).toBe(server.EDIT_WINDOW_MS)
    expect(TTL_OPTIONS.map((o) => o.seconds)).toEqual(server.TTL_OPTIONS_SECONDS)
    expect(TTL_NOTICE_CONTENT_TYPE).toBe(server.TTL_NOTICE_CONTENT_TYPE)
    expect(MAX_BODY_LENGTH).toBe(server.MAX_BODY_LENGTH)
    // HTML pattern attributes are anchored implicitly.
    expect(`^${USERNAME_PATTERN}$`).toBe(server.USERNAME_PATTERN)
  })
})
