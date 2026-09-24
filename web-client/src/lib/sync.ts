import { api } from './api'
import { advanceCursor, fromServer, type ChatDb } from './db'
import type { Receipts } from './receipts'
import type { ServerMessage, SyncResponse } from './types'

// Safety valve for a very long offline period: each page is up to 100
// messages per conversation, and the next reconnect picks up where we stopped.
const MAX_PAGES = 20

/**
 * Catches the local DB up with the server after (re)connecting: new
 * conversations, current watermarks, and any messages missed while offline.
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

      const res = await api<SyncResponse>('/sync', {
        method: 'POST',
        body: JSON.stringify({ cursors }),
      })
      await this.db.transaction('rw', this.db.conversations, this.db.messages, async () => {
        await this.db.conversations.bulkPut(res.conversations)
        await this.db.messages.bulkPut(res.messages.map(fromServer))
      })

      for (const [conversationId, messages] of groupByConversation(res.messages)) {
        const seqs = messages.map((m) => m.seq)
        await advanceCursor(
          this.db,
          conversationId,
          Math.min(...seqs),
          Math.max(...seqs),
          !(conversationId in cursors), // no cursor sent: server returned the latest page
        )
        const peerSeqs = messages.filter((m) => m.sender_id !== this.userId).map((m) => m.seq)
        if (peerSeqs.length) this.receipts.markDelivered(conversationId, Math.max(...peerSeqs))
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
