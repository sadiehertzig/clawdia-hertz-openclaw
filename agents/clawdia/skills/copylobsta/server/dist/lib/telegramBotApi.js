import { BOT_TOKEN } from "../config.js";
function apiUrl(method) {
    return `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
}
/** Send the CopyLobsta Mini App launcher button to a chat. */
export async function sendLauncherButton(chatId, startParam, miniAppBaseUrl) {
    const base = (miniAppBaseUrl || "").replace(/\/$/, "");
    if (!base) {
        throw new Error("Mini App base URL is required to send launcher button");
    }
    const miniAppUrl = startParam
        ? `${base}/miniapp/?start=${encodeURIComponent(startParam)}`
        : `${base}/miniapp/`;
    const res = await fetch(apiUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: "Hey! I can help you set up your own AI bot — your own instance, your own keys, fully yours.\n\n" +
                "It takes about 30-45 minutes and I'll walk you through every step. Ready?",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Let's do it", web_app: { url: miniAppUrl } }],
                ],
            },
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API error: ${res.status} ${body}`);
    }
    return res.json();
}
/** Send a plain text message to a chat. */
export async function sendMessage(chatId, text) {
    const res = await fetch(apiUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.json();
}
/** Delete a message (used for accidental key paste cleanup). */
export async function deleteMessage(chatId, messageId) {
    const res = await fetch(apiUrl("deleteMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    return res.json();
}
//# sourceMappingURL=telegramBotApi.js.map