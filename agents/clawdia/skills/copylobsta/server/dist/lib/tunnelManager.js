import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { PORT, SHARING_TTL_MINUTES } from "../config.js";
const START_TIMEOUT_MS = 25_000;
const KILL_GRACE_MS = 3_000;
const active = new Map();
const keyByUrl = new Map();
function extractTunnelUrl(line) {
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    return match ? match[0] : null;
}
function killProcess(proc) {
    if (proc.killed)
        return;
    proc.kill("SIGTERM");
    setTimeout(() => {
        if (!proc.killed) {
            proc.kill("SIGKILL");
        }
    }, KILL_GRACE_MS).unref();
}
function resolveCloudflaredBinary() {
    const home = process.env.HOME || "";
    const localCandidate = home ? join(home, ".local", "bin", "cloudflared") : "";
    if (localCandidate) {
        try {
            accessSync(localCandidate, constants.X_OK);
            return localCandidate;
        }
        catch {
            // Fall back to PATH lookup.
        }
    }
    return "cloudflared";
}
export async function ensureOnDemandTunnel(key) {
    const existing = active.get(key);
    if (existing && Date.now() < new Date(existing.expiresAt).getTime()) {
        return { url: existing.url, expiresAt: existing.expiresAt, pid: existing.pid };
    }
    await stopTunnel(key);
    const ttlMs = Math.max(5, SHARING_TTL_MINUTES) * 60_000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const cloudflaredBin = resolveCloudflaredBinary();
    return new Promise((resolve, reject) => {
        const proc = spawn(cloudflaredBin, ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let settled = false;
        const onOutput = (chunk) => {
            if (settled)
                return;
            const line = chunk.toString("utf8");
            const url = extractTunnelUrl(line);
            if (!url)
                return;
            settled = true;
            const timeout = setTimeout(() => {
                void stopTunnel(key);
            }, ttlMs);
            timeout.unref();
            const tunnel = {
                key,
                url,
                pid: proc.pid ?? null,
                expiresAt,
                process: proc,
                timeout,
            };
            active.set(key, tunnel);
            keyByUrl.set(url, key);
            resolve({ url, expiresAt, pid: proc.pid ?? null });
        };
        proc.stdout?.on("data", onOutput);
        proc.stderr?.on("data", onOutput);
        proc.on("error", (err) => {
            if (settled)
                return;
            settled = true;
            reject(new Error(`${cloudflaredBin} failed to start: ${err.message}`));
        });
        proc.on("exit", (code) => {
            const current = active.get(key);
            if (current && current.process.pid === proc.pid) {
                clearTimeout(current.timeout);
                active.delete(key);
                keyByUrl.delete(current.url);
            }
            if (!settled) {
                settled = true;
                reject(new Error(`cloudflared exited before tunnel URL was available (code ${code ?? "unknown"})`));
            }
        });
        setTimeout(() => {
            if (settled)
                return;
            settled = true;
            killProcess(proc);
            reject(new Error("Timed out starting Cloudflare tunnel"));
        }, START_TIMEOUT_MS).unref();
    });
}
export async function stopTunnel(key) {
    const tunnel = active.get(key);
    if (!tunnel)
        return;
    clearTimeout(tunnel.timeout);
    active.delete(key);
    keyByUrl.delete(tunnel.url);
    killProcess(tunnel.process);
}
export async function stopTunnelByUrl(url) {
    const key = keyByUrl.get(url);
    if (!key)
        return;
    await stopTunnel(key);
}
//# sourceMappingURL=tunnelManager.js.map