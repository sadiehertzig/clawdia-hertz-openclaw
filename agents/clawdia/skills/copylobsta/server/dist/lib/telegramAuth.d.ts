export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}
/** Issue a session token for a user (initData-verified or startParam-verified). */
export declare function issueSessionToken(user: TelegramUser): string;
/** Resolve a session token to a user, or null if invalid/expired. */
export declare function resolveSessionToken(token: string): TelegramUser | null;
/**
 * Validate Telegram Mini App initData and extract the user object.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export declare function requireTelegramUser(initDataRaw: string, botToken: string, { maxAgeSeconds }?: {
    maxAgeSeconds?: number | undefined;
}): TelegramUser;
/**
 * Require a user identity from initData, session token, or throw.
 * Tries initData first (Telegram-signed), falls back to session token.
 */
export declare function requireUser(initDataRaw: string, sessionToken: string, botToken: string): TelegramUser;
//# sourceMappingURL=telegramAuth.d.ts.map