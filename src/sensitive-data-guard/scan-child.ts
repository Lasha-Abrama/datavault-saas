import {
  DEFAULT_LIMITS,
  GuardLimits,
  ScanError,
  SAFE_ERRORS,
} from './guard.constants';
import { scanWorkbook } from './workbook/scan-workbook';
import { sanitizeWorkbook } from './workbook/sanitize-workbook';
import { SanitizationOptions } from './guard.constants';
import { Category, CATEGORIES } from './guard.constants';

// Only safe metadata leaves stdout. Never emit parser errors, input or stderr.
async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.from(value as Uint8Array);
    size += chunk.length;
    if (size > DEFAULT_LIMITS.compressedBytes + 16384)
      throw new ScanError('guard_limit_exceeded');
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks);
  const split = payload.indexOf(10);
  if (split < 0 || split > 16384) throw new ScanError('guard_invalid_workbook');
  const options = JSON.parse(payload.subarray(0, split).toString('utf8')) as {
    categories: Category[];
    phoneRegion?: string;
    limits: GuardLimits;
    sanitization?: SanitizationOptions;
  };
  if (
    !Array.isArray(options.categories) ||
    options.categories.some((c) => !CATEGORIES.includes(c))
  )
    throw new ScanError('guard_invalid_workbook');
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof GuardLimits)[]) {
    if (
      !Number.isInteger(options.limits[key]) ||
      options.limits[key] < 1 ||
      options.limits[key] > DEFAULT_LIMITS[key]
    )
      throw new ScanError('guard_limit_exceeded');
  }
  if (options.sanitization) {
    const selection = options.sanitization.selection;
    if (
      !selection ||
      !Array.isArray(selection.categories) ||
      selection.categories.some((c) => !options.categories.includes(c)) ||
      !Array.isArray(selection.columns) ||
      selection.columns.length > 100 ||
      selection.columns.some(
        (c) =>
          !Number.isInteger(c.sheetIndex) ||
          c.sheetIndex < 0 ||
          c.sheetIndex >= options.limits.sheets ||
          !Number.isInteger(c.column) ||
          c.column < 1 ||
          c.column > options.limits.columns ||
          typeof c.includeHeader !== 'boolean',
      )
    )
      throw new ScanError('guard_selection_invalid');
    const result = await sanitizeWorkbook(
      payload.subarray(split + 1),
      options.sanitization,
      options.limits,
    );
    process.stdout.write(
      JSON.stringify({
        sanitization: {
          outputBase64: result.bytes.toString('base64'),
          redactedCells: result.redactedCells,
          outputDigest: result.outputDigest,
        },
      }),
    );
    return;
  }
  const result = await scanWorkbook(
    payload.subarray(split + 1),
    options.categories,
    options.phoneRegion,
    options.limits,
  );
  process.stdout.write(JSON.stringify({ result }));
}
void main().catch((error) => {
  const code =
    error instanceof ScanError && SAFE_ERRORS.includes(error.code)
      ? error.code
      : 'guard_invalid_workbook';
  process.stdout.write(JSON.stringify({ errorCode: code }));
});
