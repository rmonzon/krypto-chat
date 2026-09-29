import { describe, expect, it } from 'vitest'
import { fromServer } from './db'
import { summarizeConversations } from './summary'
import { conversation, pendingMessage, serverMessage } from '../test/fakes'
import type { Conversation } from './types'

const peerMsg = (seq: number) => fromServer(serverMessage({ seq, sender_id: 'peer' }))
const myMsg = (seq: number) => fromServer(serverMessage({ seq, sender_id: 'me' }))

describe('summarizeConversations', () => {
  it('counts peer messages after my read watermark, ignoring my own', () => {
    const summary = summarizeConversations(
      [conversation({ my_read_up_to_seq: 2 })],
      [peerMsg(1), peerMsg(2), myMsg(3), peerMsg(4), peerMsg(5)],
      'me',
    ).get('conv-1')

    expect(summary).toMatchObject({ unread: 2, unreadIsLowerBound: false })
    expect(summary?.latest?.seq).toBe(5)
  })

  it('treats a pending message of mine as the latest, and never as unread', () => {
    const pending = pendingMessage()
    const summary = summarizeConversations([conversation()], [peerMsg(1), pending], 'me').get(
      'conv-1',
    )

    expect(summary).toMatchObject({ unread: 1, latest: pending })
  })

  it('flags the count as a lower bound when unread history is not stored locally', () => {
    // Read up to 2, but only 10–11 are local (3–9 not loaded yet).
    const summaries = summarizeConversations(
      [conversation({ my_read_up_to_seq: 2 })],
      [peerMsg(10), peerMsg(11)],
      'me',
    )

    expect(summaries.get('conv-1')).toMatchObject({
      unread: 2,
      unreadIsLowerBound: true,
    })
  })

  it('shows no count when the read watermark is unknown', () => {
    const cachedByOlderVersion = {
      ...conversation(),
      my_read_up_to_seq: undefined,
    } as unknown as Conversation
    const summaries = summarizeConversations([cachedByOlderVersion], [peerMsg(1)], 'me')

    expect(summaries.get('conv-1')).toMatchObject({ unread: 0 })
  })
})
