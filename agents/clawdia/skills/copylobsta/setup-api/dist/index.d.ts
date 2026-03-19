/**
 * CopyLobsta Setup API — runs temporarily on the friend's new EC2 instance.
 *
 * Accepts API keys from the Mini App, validates them, and writes them
 * to this instance's own Secrets Manager. Keys never leave this server.
 *
 * Authenticated via a session token passed as a CFN parameter.
 * Auto-shuts down after 2 hours or when /setup/complete is called.
 */
export {};
