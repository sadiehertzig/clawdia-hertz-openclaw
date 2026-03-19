/** Send the CopyLobsta Mini App launcher button to a chat. */
export declare function sendLauncherButton(chatId: string | number, startParam?: string, miniAppBaseUrl?: string): Promise<unknown>;
/** Send a plain text message to a chat. */
export declare function sendMessage(chatId: string | number, text: string): Promise<unknown>;
/** Delete a message (used for accidental key paste cleanup). */
export declare function deleteMessage(chatId: string | number, messageId: number): Promise<unknown>;
//# sourceMappingURL=telegramBotApi.d.ts.map