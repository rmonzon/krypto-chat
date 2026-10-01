import { api } from './api'
import {
  advanceChangeCursor,
  advanceCursor,
  putConversations,
  putServerMessages,
  type ChatDb,
} from './db'
import { highestPeerSeq, type Receipts } from './receipts'
import type { ServerMessage, SyncResponse } from './types'

// Safety valve for a very long offline period: each page is up to 100
// messages per conversation, and the next reconnect picks up where we stopped.
const MAX_PAGES = 20

/**
 * Catches the local DB up with the server after (re)connecting: new
 * conversations, current watermarks, any messages missed while offline, and
 * edits/deletes of messages already stored.
 */
export class Syncer {
  private readonly db: ChatDb
  private readonly userId: string
  private readonly receipts: Receipts
  private running = false
  private rerun = false

  constructor(db: ChatDb, userId: string, receipts: Receipts) {
    this.db = db
    this.userId = userId
    this.receipts = receipts
  }

  /** Safe to call often: overlapping calls collapse into one follow-up run. */
  async run() {
    if (this.running) {
      this.rerun = true
      return
    }
    this.running = true
    try {
      do {
        this.rerun = false
        await this.syncAll()
      } while (this.rerun)
    } catch {
      // Offline or server error: the next reconnect syncs again.
    } finally {
      this.running = false
    }
  }

  private async syncAll() {
    for (let page = 0; page < MAX_PAGES; page++) {
      const cursors: Record<string, number> = {}
      for (const c of await this.db.cursors.toArray()) cursors[c.conversation_id] = c.seq
      const changeCursors: Record<string, number> = {}
      for (const c of await this.db.change_cursors.toArray()) changeCursors[c.conversation_id] = c.seq

      const res = await api<SyncResponse>('/sync', {
        method: 'POST',
        body: JSON.stringify({ cursors, change_cursors: changeCursors }),
      })
      await this.db.transaction('rw', this.db.conversations, this.db.messages, async () => {
        await putConversations(this.db, res.conversations)
        await putServerMessages(this.db, res.messages)
        await putServerMessages(this.db, res.changes, { onlyExisting: true })
      })

      // Changes come in change_seq order, so the last one per conversation is
      // as far as we've applied (a later page may follow). With none, we're
      // caught up to the snapshot: also true when no cursor was sent, since
      // the latest page and any history loaded later are already current.
      const lastChange = new Map(res.changes.map((m) => [m.conversation_id, m.change_seq ?? 0]))
      for (const c of res.conversations) {
        await advanceChangeCursor(this.db, c.id, lastChange.get(c.id) ?? c.last_change_seq)
      }

      const received = groupByConversation(res.messages)
      for (const [conversationId, upTo] of Object.entries(res.synced_up_to)) {
        const sent = cursors[conversationId]
        // With a cursor, the response covers everything after it. Without one,
        // it's the latest page: from its first message (or everything, if empty).
        const from =
          sent !== undefined
            ? sent + 1
            : Math.min(...(received.get(conversationId) ?? []).map((m) => m.seq), Infinity)
        await advanceCursor(this.db, conversationId, from === Infinity ? 1 : from, upTo, sent === undefined)
      }

      for (const [conversationId, messages] of received) {
        const peerSeq = highestPeerSeq(messages, this.userId)
        if (peerSeq) this.receipts.markDelivered(conversationId, peerSeq)
      }

      if (!res.has_more) return
    }
  }
}

function groupByConversation(messages: ServerMessage[]) {
  const groups = new Map<string, ServerMessage[]>()
  for (const m of messages) {
    const group = groups.get(m.conversation_id)
    if (group) group.push(m)
    else groups.set(m.conversation_id, [m])
  }
  return groups
}
