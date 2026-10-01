// Limits the server enforces, so forms can check them first (protocol.test.ts
// checks they match api-server's).

/** Longest message body, in UTF-16 code units (JS string length). */
export const MAX_BODY_LENGTH = 10_000

/** Usernames: 3-30 lowercase letters, digits or _, as an HTML pattern (implicitly anchored). */
export const USERNAME_PATTERN = '[a-z0-9_]{3,30}'
