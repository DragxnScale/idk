/** Default per-user upload quota: 350 MB */
export const DEFAULT_QUOTA_BYTES = 350 * 1024 * 1024;

export function effectiveQuota(userQuotaBytes: number | null | undefined): number {
  return userQuotaBytes ?? DEFAULT_QUOTA_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
