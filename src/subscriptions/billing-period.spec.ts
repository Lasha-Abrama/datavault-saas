import { billingPeriod } from './billing-period';

describe('billingPeriod', () => {
  it('uses the activation day and UTC time as the monthly anchor', () => {
    expect(
      billingPeriod(
        new Date('2026-01-15T12:30:00.000Z'),
        new Date('2026-03-15T12:29:59.999Z'),
      ),
    ).toEqual({
      startsAt: new Date('2026-02-15T12:30:00.000Z'),
      endsAt: new Date('2026-03-15T12:30:00.000Z'),
    });
  });

  it('clamps month-end anchors and restores the original day later', () => {
    const activatedAt = new Date('2024-01-31T08:00:00.000Z');
    expect(
      billingPeriod(activatedAt, new Date('2024-02-29T08:00:00.000Z')),
    ).toEqual({
      startsAt: new Date('2024-02-29T08:00:00.000Z'),
      endsAt: new Date('2024-03-31T08:00:00.000Z'),
    });
    expect(
      billingPeriod(activatedAt, new Date('2024-03-31T08:00:00.000Z')),
    ).toEqual({
      startsAt: new Date('2024-03-31T08:00:00.000Z'),
      endsAt: new Date('2024-04-30T08:00:00.000Z'),
    });
  });

  it('rejects dates before activation', () => {
    expect(() =>
      billingPeriod(
        new Date('2026-05-10T00:00:00.000Z'),
        new Date('2026-05-09T23:59:59.999Z'),
      ),
    ).toThrow('Invalid billing period date');
  });
});
