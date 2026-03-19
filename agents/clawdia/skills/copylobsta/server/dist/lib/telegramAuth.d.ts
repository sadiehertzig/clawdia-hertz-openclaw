export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}
/**
 * Validate Telegram Mini App initData and extract the user object.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export declare function requireTelegramUser(initDataRaw: string, botToken: string, { maxAgeSeconds }?: {
    maxAgeSeconds?: number | undefined;
}): TelegramUser;
//# sourceMappingURL=telegramAuth.d.ts.map