/** In-memory map of deep-link start params -> referral context. */
export declare const referralStore: Map<string, {
    referrerId: string | null;
    groupId: string | null;
    intendedUserId: string | null;
    launchUrl: string;
    expiresAt: string;
}>;
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=launch.d.ts.map