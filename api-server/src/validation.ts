// Postgres text can't hold NUL (\u0000) characters: storing or even querying
// one fails as a server error. User input that reaches a text column or a
// query parameter refuses them up front.

/** JSON schema pattern for strings without NUL characters. */
export const NO_NUL_PATTERN = "^[^\\u0000]*$";

export function hasNul(value: string) {
  return value.includes("\u0000");
}
