/**
 * Security scaffolding: detect accidental API key pastes and redact secrets from logs.
 */
/** Scan text for patterns that look like API keys or secrets. Returns matched pattern names. */
export declare function scanForSecrets(text: string): string[];
/** Returns true if the text contains anything that looks like a secret. */
export declare function containsSecrets(text: string): boolean;
/** Replace any detected secrets in text with [REDACTED]. */
export declare function redactSecrets(text: string): string;
//# sourceMappingURL=security.d.ts.map