/**
 * Validates API keys by making test calls to each provider.
 * Runs on the friend's instance — keys never leave this server.
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    metadata?: Record<string, string>;
}
export declare function validateKey(provider: string, key: string): Promise<ValidationResult>;
