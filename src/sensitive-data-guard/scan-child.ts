import {
  DEFAULT_LIMITS,
  GuardLimits,
  ScanError,
  SAFE_ERRORS,
} from './guard.constants';
import { scanWorkbook } from './workbook/scan-workbook';
import { Category, CATEGORIES } from './guard.constants';

// Only safe metadata leaves stdout. Never emit parser errors, input or stderr.
async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.from(value as Uint8Array);
    size += chunk.length;
    if (size > DEFAULT_LIMITS.compressedBytes + 4096)
      throw new ScanError('guard_limit_exceeded');
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks);
  const split = payload.indexOf(10);
  if (split < 0 || split > 4096) throw new ScanError('guard_invalid_workbook');
  const options = JSON.parse(payload.subarray(0, split).toString('utf8')) as {
    categories: Category[];
    phoneRegion?: string;
    limits: GuardLimits;
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
