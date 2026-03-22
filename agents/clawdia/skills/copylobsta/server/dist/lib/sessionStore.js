import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, openSync, closeSync, unlinkSync, constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SESSION_ENCRYPTION_KEY } from "../config.js";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SESSIONS_DIR = resolve(__dirname, "..", "..", "..", "data", "sessions");
// Ensure sessions directory exists
if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
}
function sessionPath(userId) {
    return resolve(SESSIONS_DIR, `${userId}.json`);
}
function lockPath(userId) {
    return resolve(SESSIONS_DIR, `${userId}.lock`);
}
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 50;
const ENCRYPTION_ALGO = "aes-256-gcm";
/** Acquire a file lock for a user session. Spins until acquired or timeout. */
function acquireLock(userId) {
    const lock = lockPath(userId);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
        try {
            const fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
            closeSync(fd);
            return;
        }
        catch {
            if (Date.now() > deadline) {
                // Stale lock — force remove and retry once
                try {
                    unlinkSync(lock);
                }
                catch { /* ignore */ }
                try {
                    const fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
                    closeSync(fd);
                    return;
                }
                catch {
                    throw new Error(`Could not acquire session lock for user ${userId}`);
                }
            }
            // Busy-wait briefly
            const start = Date.now();
            while (Date.now() - start < LOCK_RETRY_MS) { /* spin */ }
        }
    }
}
/** Release the file lock for a user session. */
function releaseLock(userId) {
    try {
        unlinkSync(lockPath(userId));
    }
    catch { /* ignore */ }
}
/** Execute a function while holding the session lock. */
function withLock(userId, fn) {
    acquireLock(userId);
    try {
        return fn();
    }
    finally {
        releaseLock(userId);
    }
}
function normalizeSession(session) {
    return {
        ...session,
        aws: {
            ...session.aws,
            setupBaseUrl: session.aws.setupBaseUrl || null,
        },
        callbackSecret: session.callbackSecret || null,
        sharingEnabled: !!session.sharingEnabled,
        sharingSession: session.sharingSession || null,
    };
}
function getSessionKey() {
    const raw = SESSION_ENCRYPTION_KEY.trim();
    if (!raw)
        return null;
    return createHash("sha256").update(raw, "utf8").digest();
}
function isEncryptedEnvelope(value) {
    if (!value || typeof value !== "object")
        return false;
    const v = value;
    return v.encrypted === true && v.version === 1 && typeof v.iv === "string" && typeof v.tag === "string" && typeof v.data === "string";
}
function encryptSession(session, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
    const plaintext = Buffer.from(JSON.stringify(session), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
        version: 1,
        encrypted: true,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        data: ciphertext.toString("base64"),
    };
    return JSON.stringify(envelope, null, 2);
}
function decryptSession(raw, key) {
    const parsed = JSON.parse(raw);
    if (!isEncryptedEnvelope(parsed)) {
        throw new Error("Session file is not encrypted envelope format");
    }
    const iv = Buffer.from(parsed.iv, "base64");
    const tag = Buffer.from(parsed.tag, "base64");
    const data = Buffer.from(parsed.data, "base64");
    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return normalizeSession(JSON.parse(plaintext));
}
function readSessionFromPath(path) {
    const raw = readFileSync(path, "utf-8");
    const key = getSessionKey();
    const parsed = JSON.parse(raw);
    if (isEncryptedEnvelope(parsed)) {
        if (!key) {
            throw new Error("Encrypted session file found but COPYLOBSTA_SESSION_ENCRYPTION_KEY is missing");
        }
        return decryptSession(raw, key);
    }
    // Backward-compatible plaintext read for migration.
    const session = normalizeSession(parsed);
    if (key) {
        writeFileSync(path, encryptSession(session, key));
    }
    return session;
}
function writeSessionToPath(path, session) {
    const normalized = normalizeSession(session);
    const key = getSessionKey();
    if (key) {
        writeFileSync(path, encryptSession(normalized, key));
        return;
    }
    writeFileSync(path, JSON.stringify(normalized, null, 2));
}
function createDefaultSession(userId, username) {
    const now = new Date().toISOString();
    return {
        sessionId: `copy_${Date.now()}_${randomBytes(4).toString("hex")}`,
        referrerTelegramId: null,
        friendTelegramId: userId,
        friendUsername: username,
        groupChatId: null,
        state: "WELCOME",
        previousState: null,
        createdAt: now,
        updatedAt: now,
        aws: {
            hasAccount: null,
            stackId: null,
            instanceId: null,
            instanceIp: null,
            setupBaseUrl: null,
            ssmVerified: false,
            region: "us-east-1",
        },
        sharingEnabled: false,
        sharingSession: null,
        credentials: {
            githubUsername: null,
            anthropic: "unset",
            gemini: "unset",
            openai: "unset",
            telegramToken: "unset",
            botUsername: null,
        },
        setupToken: null,
        callbackSecret: null,
        user: {
            answers: {},
            draftMarkdown: null,
            approved: false,
        },
        soul: {
            answers: {},
            draftMarkdown: null,
            approved: false,
        },
        deploy: {
            startedAt: null,
            completedAt: null,
            stepsCompleted: [],
            error: null,
        },
    };
}
/** Get an existing session or create a new one for this user. */
export function getOrCreate(userId, username = null) {
    return withLock(String(userId), () => {
        const path = sessionPath(String(userId));
        if (existsSync(path)) {
            const loaded = readSessionFromPath(path);
            writeSessionToPath(path, loaded);
            return loaded;
        }
        const session = createDefaultSession(userId, username);
        writeSessionToPath(path, session);
        return session;
    });
}
/** Reset a user's session file to a fresh WELCOME session. */
export function reset(userId, username = null) {
    return withLock(String(userId), () => {
        const session = createDefaultSession(userId, username);
        writeSessionToPath(sessionPath(String(userId)), session);
        return session;
    });
}
/** Get a session by user ID. Returns null if not found. */
export function get(userId) {
    const path = sessionPath(String(userId));
    if (!existsSync(path))
        return null;
    return readSessionFromPath(path);
}
/** Find a session by its setup token (for instance callback auth). */
export function findBySetupToken(token) {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
        const session = readSessionFromPath(resolve(SESSIONS_DIR, file));
        if (session.setupToken === token) {
            return session;
        }
    }
    return null;
}
/** Find all active sessions (not COMPLETE, ABANDONED, or FAILED). */
export function findActiveSessions() {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
    const active = [];
    for (const file of files) {
        const session = readSessionFromPath(resolve(SESSIONS_DIR, file));
        if (!["COMPLETE", "ABANDONED", "FAILED"].includes(session.state)) {
            active.push(session);
        }
    }
    return active;
}
/** Find an active session for a specific friend (by Telegram ID). */
export function findActiveByFriendId(friendId) {
    const path = sessionPath(String(friendId));
    if (!existsSync(path))
        return null;
    const session = readSessionFromPath(path);
    if (["COMPLETE", "ABANDONED", "FAILED"].includes(session.state))
        return null;
    return session;
}
const ABANDONED_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/** Check if a session should be marked as abandoned. */
export function isStale(session) {
    const updated = new Date(session.updatedAt).getTime();
    return Date.now() - updated > ABANDONED_AFTER_MS;
}
/** Update a session with a partial patch. Returns the updated session. */
export function update(userId, patch) {
    return withLock(String(userId), () => {
        const session = get(userId);
        if (!session)
            throw new Error(`No session for user ${userId}`);
        const updated = {
            ...session,
            ...patch,
            updatedAt: new Date().toISOString(),
            // Deep-merge nested objects
            aws: { ...session.aws, ...(patch.aws || {}) },
            credentials: { ...session.credentials, ...(patch.credentials || {}) },
            soul: { ...session.soul, ...(patch.soul || {}) },
            user: { ...session.user, ...(patch.user || {}) },
            deploy: { ...session.deploy, ...(patch.deploy || {}) },
        };
        const normalized = normalizeSession(updated);
        writeSessionToPath(sessionPath(String(userId)), normalized);
        return normalized;
    });
}
//# sourceMappingURL=sessionStore.js.map