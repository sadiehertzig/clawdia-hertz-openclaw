/**
 * Writes API keys to this instance's own AWS Secrets Manager.
 * Uses the instance's IAM role — no credentials needed.
 */
export declare function writeSecret(provider: string, value: string): Promise<void>;
