export declare function ensureOnDemandTunnel(key: string): Promise<{
    url: string;
    expiresAt: string;
    pid: number | null;
}>;
export declare function stopTunnel(key: string): Promise<void>;
export declare function stopTunnelByUrl(url: string): Promise<void>;
//# sourceMappingURL=tunnelManager.d.ts.map