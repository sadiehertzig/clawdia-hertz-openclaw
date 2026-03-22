/** Send the CopyLobsta Mini App launcher button to a chat.
 *  web_app inline buttons only work in private chats, so when sending to a
 *  group (BUTTON_TYPE_INVALID), we DM the user with the web_app button and
 *  post a notice in the group instead.
 */
export declare function sendLauncherButton(chatId: string | number, startParam?: string, miniAppBaseUrl?: string, userId?: string | number | null): Promise<unknown>;
/** Send a plain text message to a chat. */
export declare function sendMessage(chatId: string | number, text: string): Promise<unknown>;
/** Delete a message (used for accidental key paste cleanup). */
export declare function deleteMessage(chatId: string | number, messageId: number): Promise<unknown>;
//# sourceMappingURL=telegramBotApi.d.ts.map