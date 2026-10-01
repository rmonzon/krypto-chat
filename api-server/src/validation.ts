// Postgres text can't hold NUL (\u0000) characters: storing or even querying
// one fails as a server error. User input that reaches a text column or a
// query parameter refuses them up front.

/** JSON schema pattern for strings without NUL characters. */
export const NO_NUL_PATTERN = "^[^\\u0000]*$";

export function hasNul(value: string) {
  return value.includes("\u0000");
}

/** Usernames: 3-30 lowercase letters, digits or _ (the profiles table checks the same). */
export const USERNAME_PATTERN = "^[a-z0-9_]{3,30}$";

/** Longest message body, in UTF-16 code units (JS string length). */
export const MAX_BODY_LENGTH = 10_000;
