/**
 * CopyLobsta Setup API — runs temporarily on the friend's new EC2 instance.
 *
 * Accepts API keys from the Mini App, validates them, and writes them
 * to this instance's own Secrets Manager. Keys never leave this server.
 *
 * Authenticated via a session token passed as a CFN parameter.
 * Auto-shuts down after 2 hours or when /setup/complete is called.
 */
import express from "express";
import cors from "cors";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateKey } from "./keyValidator.js";
import { writeSecret } from "./secretsWriter.js";
const PORT = parseInt(process.env.SETUP_API_PORT || "8080", 10);
const BIND_ADDR = process.env.SETUP_BIND || "127.0.0.1";
const SESSION_TOKEN = process.env.SESSION_TOKEN || "";
const AUTO_SHUTDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
if (!SESSION_TOKEN) {
    console.error("SESSION_TOKEN environment variable is required");
    process.exit(1);
}
const app = express();
// CORS: only the CopyLobsta server (server-to-server proxy) calls this API.
app.use(cors({ origin: false }));
app.use(express.json());
function requireToken(req, res, next) {
    const token = req.headers["x-session-token"] ||
        req.body?.sessionToken ||
        "";
    if (token !== SESSION_TOKEN) {
        res.status(401).json({ error: "Invalid session token" });
        return;
    }
    next();
}
app.get("/setup/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
});
app.post("/setup/validate-key", requireToken, async (req, res) => {
    const { provider, key } = req.body;
    if (!provider || !key) {
        res.status(400).json({ error: "Missing provider or key" });
        return;
    }
    const result = await validateKey(provider, key);
    if (!result.valid) {
        res.json({ valid: false, error: result.error });
        return;
    }
    try {
        await writeSecret(provider, key);
        res.json({ valid: true, metadata: result.metadata || {} });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to write secret for ${provider}:`, message);
        res.json({
            valid: false,
            error: `Key is valid but we couldn't save it. Error: ${message}`,
        });
    }
});
let deployProgress = [];
app.get("/setup/deploy-status", requireToken, (_req, res) => {
    res.json({ steps: deployProgress });
});
async function runDeployStep(name, fn) {
    const step = deployProgress.find((s) => s.name === name);
    if (step)
        step.status = "running";
    try {
        await fn();
        if (step)
            step.status = "done";
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (step) {
            step.status = "failed";
            step.error = message;
        }
        throw err;
    }
}
app.post("/setup/deploy", requireToken, async (req, res) => {
    const { soulMarkdown, userMarkdown, botUsername } = req.body;
    if (!soulMarkdown) {
        res.status(400).json({ ok: false, error: "Missing soulMarkdown" });
        return;
    }
    deployProgress = [
        { name: "clone_repo", status: "pending" },
        { name: "install_deps", status: "pending" },
        { name: "write_soul", status: "pending" },
        { name: "write_user", status: "pending" },
        { name: "configure", status: "pending" },
        { name: "start_pm2", status: "pending" },
        { name: "health_check", status: "pending" },
        { name: "auto_restart", status: "pending" },
    ];
    const deployAsync = async () => {
        const { writeFile } = await import("node:fs/promises");
        const homeDir = process.env.HOME || "/home/openclaw";
        const repoDir = resolve(process.env.COPYLOBSTA_REPO_DIR || resolve(homeDir, "copylobsta"));
        const homeRepoDir = resolve(homeDir, "copylobsta");
        // Step 1: Verify repo exists (no git pull from moving HEAD)
        await runDeployStep("clone_repo", async () => {
            if (!existsSync(repoDir)) {
                throw new Error(`CopyLobsta repo not found at ${repoDir}`);
            }
            // Restrict deploy writes to expected install paths.
            if (repoDir !== homeRepoDir && !repoDir.startsWith(`${homeRepoDir}/`)) {
                throw new Error(`COPYLOBSTA_REPO_DIR must be inside ${homeRepoDir}`);
            }
        });
        // Step 2: Install dependencies
        await runDeployStep("install_deps", async () => {
            execFileSync("bash", ["setup/install.sh"], {
                cwd: repoDir,
                timeout: 180_000,
                stdio: "pipe",
            });
        });
        // Step 3: Write SOUL.md
        await runDeployStep("write_soul", async () => {
            await writeFile(resolve(repoDir, "SOUL.md"), soulMarkdown, "utf-8");
        });
        // Step 4: Write USER.md
        await runDeployStep("write_user", async () => {
            if (userMarkdown) {
                await writeFile(resolve(repoDir, "USER.md"), userMarkdown, "utf-8");
            }
        });
        await runDeployStep("configure", async () => {
            // Configuration is handled by install.sh and env vars.
        });
        await runDeployStep("start_pm2", async () => {
            try {
                execFileSync("bash", ["-lc",
                    "systemctl --user restart openclaw-gateway 2>&1 || pm2 restart openclaw-gateway 2>&1 || true",
                ], { timeout: 30_000, stdio: "pipe" });
            }
            catch {
                // Best effort
            }
        });
        await runDeployStep("health_check", async () => {
            await new Promise((r) => setTimeout(r, 3000));
            try {
                execFileSync("bash", ["-lc",
                    "curl -sf http://localhost:3000/health || curl -sf http://localhost:8443/health || true",
                ], { timeout: 10_000, stdio: "pipe" });
            }
            catch {
                // Best effort
            }
        });
        await runDeployStep("auto_restart", async () => {
            try {
                execFileSync("bash", ["-lc",
                    "pm2 save 2>&1 || systemctl --user enable openclaw-gateway 2>&1 || true",
                ], { timeout: 10_000, stdio: "pipe" });
            }
            catch {
                // Best effort
            }
        });
    };
    try {
        await deployAsync();
        res.json({ ok: true, botUsername: botUsername || null });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Deploy error:", message);
        res.json({ ok: false, error: message });
    }
});
app.post("/setup/complete", requireToken, (_req, res) => {
    res.json({ ok: true, message: "Setup complete. Shutting down setup API." });
    console.log("Setup complete. Shutting down in 5 seconds...");
    // Stop temporary setup tunnel if it exists.
    try {
        execFileSync("pkill", ["-f", "cloudflared tunnel --url http://localhost:8080"], { stdio: "pipe" });
    }
    catch {
        // Best effort
    }
    setTimeout(() => process.exit(0), 5000);
});
const server = app.listen(PORT, BIND_ADDR, () => {
    console.log(`CopyLobsta Setup API running on http://${BIND_ADDR}:${PORT}`);
    console.log(`Auto-shutdown in ${AUTO_SHUTDOWN_MS / 1000 / 60} minutes`);
});
setTimeout(() => {
    console.log("Auto-shutdown timeout reached. Exiting.");
    server.close();
    process.exit(0);
}, AUTO_SHUTDOWN_MS);
//# sourceMappingURL=index.js.map