/**
 * Builds a CloudFormation quick-create URL with pre-filled parameters.
 * The friend clicks this URL to launch the stack in their own AWS Console.
 */
export interface QuickCreateParams {
    region?: string;
    templateUrl?: string;
    callbackUrl: string;
    sessionToken: string;
    budgetEmail?: string;
    instanceType?: string;
}
/**
 * Generate a CloudFormation quick-create URL.
 * Opens the AWS Console with the stack pre-configured and ready to launch.
 */
export declare function buildQuickCreateUrl(params: QuickCreateParams): string;
/** Generate a random session token for setup API auth. */
export declare function generateSessionToken(): string;
//# sourceMappingURL=cfnUrl.d.ts.map