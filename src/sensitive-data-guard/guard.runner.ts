import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Category,
  CATEGORIES,
  COMPATIBILITY_FLAGS,
  GUARD_LIMITS,
  GuardLimits,
  SAFE_ERRORS,
  ScanError,
  ScanResult,
  SanitizationOptions,
  SanitizationResult,
} from './guard.constants';
@Injectable()
export class GuardRunner {
  constructor(@Inject(GUARD_LIMITS) private readonly limits: GuardLimits) {}
  async run(
    bytes: Buffer,
    categories: Category[],
    phoneRegion: string | undefined,
    signal: AbortSignal,
  ): Promise<ScanResult> {
    const result = await this.execute(bytes, categories, phoneRegion, signal);
    if (!('findings' in result)) throw new ScanError('guard_invalid_workbook');
    return result;
  }
  async sanitize(
    bytes: Buffer,
    options: SanitizationOptions,
    signal: AbortSignal,
  ): Promise<SanitizationResult> {
    const result = await this.execute(
      bytes,
      options.categories,
      options.phoneRegion,
      signal,
      options,
    );
    if (!('bytes' in result))
      throw new ScanError('guard_output_verification_failed');
    return result;
  }
  private async execute(
    bytes: Buffer,
    categories: Category[],
    phoneRegion: string | undefined,
    signal: AbortSignal,
    sanitization?: SanitizationOptions,
  ): Promise<ScanResult | SanitizationResult> {
    // Development also needs a compiled child; never run an untrusted parser in API JS.
    const directory = resolve(
      __dirname.endsWith('/dist/sensitive-data-guard')
        ? __dirname
        : resolve(process.cwd(), 'dist/sensitive-data-guard'),
    );
    const entry = resolve(directory, 'scan-child.js');
    if (!existsSync(entry) || Number(process.versions.node.split('.')[0]) < 24)
      throw new ScanError('guard_worker_unavailable');
    if (signal.aborted) throw new ScanError('guard_access_revoked');
    return new Promise((res, rej) => {
      const child = spawn(
        process.execPath,
        [
          '--permission',
          `--allow-fs-read=${directory}`,
          `--allow-fs-read=${resolve(process.cwd(), 'node_modules')}`,
          '--max-old-space-size=128',
          '--disable-proto=throw',
          '--disallow-code-generation-from-strings',
          entry,
        ],
        { env: { NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      let length = 0,
        settled = false;
      const chunks: Buffer[] = [];
      const finish = (
        error?: ScanError,
        result?: ScanResult | SanitizationResult,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        child.kill('SIGKILL');
        if (error) rej(error);
        else if (result) res(result);
      };
      const abort = () => finish(new ScanError('guard_access_revoked'));
      const timer = setTimeout(
        () => finish(new ScanError('guard_timeout')),
        this.limits.durationMs,
      );
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () =>
        finish(new ScanError('guard_worker_unavailable')),
      );
      child.stdin.on('error', () =>
        finish(new ScanError('guard_worker_unavailable')),
      );
      child.stdout.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (
          length >
          (sanitization
            ? Math.ceil((this.limits.compressedBytes * 4) / 3) + 4096
            : 2 * 1024 * 1024)
        )
          finish(new ScanError('guard_limit_exceeded'));
        else chunks.push(chunk);
      });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0)
          return finish(new ScanError('guard_worker_unavailable'));
        try {
          const response = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
          ) as {
            errorCode?: string;
            result?: ScanResult;
            sanitization?: {
              outputBase64: string;
              redactedCells: number;
              outputDigest: string;
            };
          };
          if (response.errorCode)
            return finish(
              new ScanError(
                SAFE_ERRORS.includes(response.errorCode as ScanError['code'])
                  ? (response.errorCode as ScanError['code'])
                  : 'guard_invalid_workbook',
              ),
            );
          if (sanitization) {
            const generated = response.sanitization;
            if (
              !generated ||
              typeof generated.outputBase64 !== 'string' ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(generated.outputBase64)
            )
              throw new Error();
            const output = Buffer.from(generated.outputBase64, 'base64');
            if (
              !output.length ||
              output.length > this.limits.compressedBytes ||
              !Number.isInteger(generated.redactedCells) ||
              generated.redactedCells < 1 ||
              generated.redactedCells > this.limits.cells ||
              createHash('sha256').update(output).digest('hex') !==
                generated.outputDigest
            )
              throw new Error();
            return finish(undefined, {
              bytes: output,
              redactedCells: generated.redactedCells,
              outputDigest: generated.outputDigest,
            });
          }
          if (
            !response.result ||
            response.result.findings.length > this.limits.findings
          )
            throw new Error();
          const result = response.result;
          const integer = (value: number, min: number, max: number) =>
            Number.isInteger(value) && value >= min && value <= max;
          if (
            !integer(result.processedCells, 0, this.limits.cells) ||
            !integer(result.sheets, 1, this.limits.sheets) ||
            result.coverage !== 'limited' ||
            !Array.isArray(result.compatibilityFlags) ||
            result.compatibilityFlags.length > COMPATIBILITY_FLAGS.length ||
            result.compatibilityFlags.some(
              (flag) =>
                !COMPATIBILITY_FLAGS.includes(
                  flag as (typeof COMPATIBILITY_FLAGS)[number],
                ),
            )
          )
            throw new Error();
          const findings = result.findings.map((f, index) => {
            if (
              f.ordinal !== index ||
              !integer(f.sheetIndex, 0, result.sheets - 1) ||
              !integer(f.row, 1, this.limits.rows) ||
              !integer(f.column, 1, this.limits.columns) ||
              !CATEGORIES.includes(f.category) ||
              !categories.includes(f.category) ||
              !['format_valid', 'checksum_valid'].includes(f.evidence) ||
              typeof f.hidden !== 'boolean'
            )
              throw new Error();
            return {
              ordinal: f.ordinal,
              sheetIndex: f.sheetIndex,
              row: f.row,
              column: f.column,
              category: f.category,
              evidence: f.evidence,
              hidden: f.hidden,
            };
          });
          finish(undefined, {
            findings,
            processedCells: result.processedCells,
            sheets: result.sheets,
            compatibilityFlags: result.compatibilityFlags,
            coverage: result.coverage,
          });
        } catch {
          finish(new ScanError('guard_invalid_workbook'));
        }
      });
      child.stdin.end(
        Buffer.concat([
          Buffer.from(
            JSON.stringify({
              categories,
              phoneRegion,
              limits: this.limits,
              sanitization,
            }) + '\n',
          ),
          bytes,
        ]),
      );
    });
  }
}
