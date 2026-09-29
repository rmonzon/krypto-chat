// Glyph pool for cipher effects: half-width katakana + latin + digits + terminal symbols.
export const GLYPHS = Array.from(
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
    '#%&@$?/\\<>=*+~^|{}[]()!:;-_',
)

export function randGlyph(): string {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0]
}
