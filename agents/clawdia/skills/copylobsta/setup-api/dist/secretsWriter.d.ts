/**
 * Writes API keys to this instance's own AWS Secrets Manager.
 * Uses the instance's IAM role — no credentials needed.
 */
/**
 * Read a secret value from Secrets Manager.
 * Returns empty string only if the secret genuinely doesn't exist.
 * Throws on IAM/network/service errors so callers can distinguish
 * "not stored yet" from "infrastructure broken."
 */
export declare function readSecret(provider: string): Promise<string>;
export declare function writeSecret(provider: string, value: string): Promise<void>;
