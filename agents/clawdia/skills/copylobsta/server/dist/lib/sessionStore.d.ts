import type { Session } from "../types.js";
/** Get an existing session or create a new one for this user. */
export declare function getOrCreate(userId: number, username?: string | null): Session;
/** Reset a user's session file to a fresh WELCOME session. */
export declare function reset(userId: number, username?: string | null): Session;
/** Get a session by user ID. Returns null if not found. */
export declare function get(userId: number): Session | null;
/** Find a session by its setup token (for instance callback auth). */
export declare function findBySetupToken(token: string): Session | null;
/** Find all active sessions (not COMPLETE, ABANDONED, or FAILED). */
export declare function findActiveSessions(): Session[];
/** Find an active session for a specific friend (by Telegram ID). */
export declare function findActiveByFriendId(friendId: number): Session | null;
/** Check if a session should be marked as abandoned. */
export declare function isStale(session: Session): boolean;
/** Update a session with a partial patch. Returns the updated session. */
export declare function update(userId: number, patch: Partial<Session>): Session;
//# sourceMappingURL=sessionStore.d.ts.map