export const CATEGORIES = [
  'email',
  'phone',
  'payment_card',
  'iban',
  'ip',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const STATES = [
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type GuardState = (typeof STATES)[number];
export const GUARD_LIMITS = Symbol('GUARD_LIMITS');
export const GUARD_RUNTIME_POLICY = Symbol('GUARD_RUNTIME_POLICY');
export interface GuardRuntimePolicy {
  isolationApproved: boolean;
  sanitizationApproved?: boolean;
}
// Deployment must establish OS memory/CPU and network isolation before admission.
export const DEFAULT_RUNTIME_POLICY: GuardRuntimePolicy = Object.freeze({
  isolationApproved: false,
  sanitizationApproved: false,
});
export const DEFAULT_LIMITS = Object.freeze({
  compressedBytes: 10 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  entries: 500,
  ratio: 100,
  sheets: 20,
  rows: 100000,
  columns: 512,
  cells: 100000,
  textBytes: 8192,
  findings: 5000,
  durationMs: 30000,
  ioMs: 15000,
  leaseMs: 120000,
});
export type GuardLimits = { [K in keyof typeof DEFAULT_LIMITS]: number };
export const SAFE_ERRORS = [
  'guard_invalid_workbook',
  'guard_limit_exceeded',
  'guard_timeout',
  'guard_access_revoked',
  'guard_storage_unavailable',
  'guard_worker_unavailable',
  'guard_internal_error',
  'guard_profile_unsupported',
  'guard_selection_invalid',
  'guard_source_changed',
  'guard_output_verification_failed',
  'guard_quota_exceeded',
] as const;
export type GuardErrorCode = (typeof SAFE_ERRORS)[number];
export class ScanError extends Error {
  constructor(public readonly code: GuardErrorCode) {
    super(code);
  }
}
export interface SafeFinding {
  ordinal: number;
  sheetIndex: number;
  row: number;
  column: number;
  category: Category;
  evidence: 'format_valid' | 'checksum_valid';
  hidden: boolean;
}
export interface ScanResult {
  findings: SafeFinding[];
  processedCells: number;
  sheets: number;
  compatibilityFlags: string[];
  coverage: 'supported' | 'limited';
}

export const COMPATIBILITY_FLAGS = [
  'cell_text_only',
  'metadata_not_scanned',
  'unsupported_parts',
  'hyperlinks',
  'defined_names',
  'formulas',
  'unsupported_elements',
  'merged_cells',
  'unreferenced_shared_strings',
] as const;

export interface RedactionColumn {
  sheetIndex: number;
  column: number;
  includeHeader: boolean;
}
export interface RedactionSelection {
  categories: Category[];
  columns: RedactionColumn[];
}
export interface SanitizationOptions {
  selection: RedactionSelection;
  categories: Category[];
  phoneRegion?: string;
  findingsDigest: string;
}
export interface SanitizationResult {
  bytes: Buffer;
  redactedCells: number;
  outputDigest: string;
}
export const REDACTION_MARKER = '[REDACTED]';
export const SANITIZATION_VERSION = 'plain_ooxml_redaction_v1';
