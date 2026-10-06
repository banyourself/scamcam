import type { ScanReport } from "./report";

export const shareMinutes = [5, 10, 15] as const;
export type ShareMinutes = (typeof shareMinutes)[number];
export const defaultShareMinutes: ShareMinutes = 10;
export const shareWindowMinutes = 30;
export const shareIdPattern = /^[A-Za-z0-9_-]{22}$/;
export const shareKeyPattern = /^[A-Za-z0-9_-]{22}$/;
export const reportSignatureHeader = "X-Report-Signature";

export interface SharedReport {
  report: ScanReport;
  includesMessage: boolean;
  sharedAt: string;
  expiresAt: string;
}

export interface CreatedShare {
  id: string;
  key: string;
  expiresAt: string;
}

export interface StoredShare {
  iv: string;
  ciphertext: string;
  expiresAt: string;
}
