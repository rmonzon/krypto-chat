// Values clients rely on, kept in one dependency-free module. web-client has
// its own copies (the projects are separate); its protocol.test.ts imports
// this file to check they still agree, so change both sides together.

/** How long after sending a message its sender can still edit or delete it. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Auto-delete timers clients can pick: 5 minutes to 30 days. */
export const TTL_OPTIONS_SECONDS = [300, 3600, 86_400, 604_800, 2_592_000];

/** Content types the server posts itself; clients can't send them. */
export const SYSTEM_CONTENT_PREFIX = "application/vnd.krypto-chat.";

/** The notice posted when someone changes the auto-delete timer. Body: {"ttl_seconds": n | null}. */
export const TTL_NOTICE_CONTENT_TYPE = `${SYSTEM_CONTENT_PREFIX}ttl+json`;

/** Usernames: 3-30 lowercase letters, digits or _ (the profiles table checks the same). */
export const USERNAME_PATTERN = "^[a-z0-9_]{3,30}$";

/** Longest message body, in UTF-16 code units (JS string length). */
export const MAX_BODY_LENGTH = 10_000;
