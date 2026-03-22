/** Resolve CloudFormation template URL.
 *  Priority:
 *  1) S3 pre-signed URL when COPYLOBSTA_TEMPLATE_S3_BUCKET + COPYLOBSTA_TEMPLATE_S3_KEY are set
 *  2) Static CFN_TEMPLATE_URL fallback
 */
export declare function resolveTemplateUrl(): Promise<string>;
//# sourceMappingURL=templateUrl.d.ts.map