/** FNV-1a: a small, fast string hash that spreads similar strings well. Not cryptographic. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h
}
