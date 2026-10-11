import { GuardRunner } from './guard.runner';
import { CATEGORIES, DEFAULT_LIMITS } from './guard.constants';
import { workbook, CANARIES } from '../../test/fixtures/guard/workbook';
describe('isolated scan runner (requires build)', () => {
  it('runs real compiled child without emitting workbook values', async () => {
    const result = await new GuardRunner(DEFAULT_LIMITS).run(
      workbook(),
      [...CATEGORIES],
      undefined,
      new AbortController().signal,
    );
    expect(result.findings).toHaveLength(6);
    for (const raw of CANARIES)
      expect(JSON.stringify(result)).not.toContain(raw);
  });
  it('kills work on cancellation and timeout', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      new GuardRunner(DEFAULT_LIMITS).run(
        workbook(),
        ['email'],
        undefined,
        cancelled.signal,
      ),
    ).rejects.toHaveProperty('code', 'guard_access_revoked');
    await expect(
      new GuardRunner({ ...DEFAULT_LIMITS, durationMs: 1 }).run(
        workbook(),
        ['email'],
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toHaveProperty('code', 'guard_timeout');
  });
});
