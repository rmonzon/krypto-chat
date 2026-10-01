import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { OlderPage } from '../lib/history'
import type { Message } from '../lib/types'

/**
 * Loads older history as the top of the list scrolls into view, keeping the
 * reader's place while messages are prepended. Attach topRef to an element
 * at the top of the list.
 */
export function useOlderHistory(
  listRef: RefObject<HTMLElement | null>,
  messages: Message[],
  onLoadOlder: (beforeSeq: number) => Promise<OlderPage>,
) {
  const topRef = useRef<HTMLLIElement>(null)
  // Seqs start at 1, so the oldest being 1 means there's nothing older. Above
  // 1 there may be (or the rest expired): ask until the server says that's all.
  let oldestSeq: number | null = null
  for (const m of messages) {
    if (m.seq !== null && (oldestSeq === null || m.seq < oldestSeq)) oldestSeq = m.seq
  }
  const [noOlder, setNoOlder] = useState(false)
  const hasOlder = oldestSeq !== null && oldestSeq > 1 && !noOlder
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // Scroll position captured before prepending, restored once the list grows.
  const anchor = useRef<{ height: number; top: number } | null>(null)

  const loadOlder = useCallback(async () => {
    const list = listRef.current
    if (!list || !hasOlder || loading || oldestSeq === null) return
    anchor.current = { height: list.scrollHeight, top: list.scrollTop }
    setLoading(true)
    setFailed(false)
    try {
      const page = await onLoadOlder(oldestSeq)
      if (page.count === 0) anchor.current = null
      if (!page.hasMore) setNoOlder(true)
    } catch {
      anchor.current = null
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [listRef, hasOlder, loading, oldestSeq, onLoadOlder])

  // Keep the reader's place: shift scrollTop by however much was added above.
  useLayoutEffect(() => {
    const list = listRef.current
    const saved = anchor.current
    if (!list || !saved || list.scrollHeight === saved.height) return
    list.scrollTop = saved.top + (list.scrollHeight - saved.height)
    anchor.current = null
  }, [listRef, messages])

  // Load older history when the top of the list scrolls into view.
  useEffect(() => {
    const list = listRef.current
    const top = topRef.current
    if (!list || !top || !hasOlder || failed) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadOlder()
      },
      { root: list, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(top)
    return () => observer.disconnect()
  }, [listRef, hasOlder, failed, loadOlder])

  return { topRef, loading, failed, loadOlder }
}
