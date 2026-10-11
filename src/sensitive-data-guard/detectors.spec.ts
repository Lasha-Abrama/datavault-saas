import { detect, luhn } from './detectors';
import { CATEGORIES } from './guard.constants';
describe('deterministic detectors', () => {
  it.each([
    ['test.person@example.com', 'email'],
    ['+1 213 373 4253', 'phone'],
    ['4111 1111 1111 1111', 'payment_card'],
    ['GB82 WEST 1234 5698 7654 32', 'iban'],
    ['Account: GB82 WEST 1234 5698 7654 32 invoice', 'iban'],
    ['192.0.2.1', 'ip'],
    ['2001:db8::1', 'ip'],
  ])('validates %s without returning its value', (value, category) => {
    expect(detect(value, [...CATEGORIES])).toContain(category);
    expect(JSON.stringify(detect(value, [...CATEGORIES]))).not.toContain(value);
  });
  it.each([
    'not-an-email',
    '256.1.2.3',
    '1111111111111111',
    '4111111111111112',
    'GB83 WEST 1234 5698 7654 32',
    '12345678',
  ])('rejects ordinary/invalid values: %s', (value) =>
    expect(detect(value, [...CATEGORIES])).toEqual([]),
  );
  it('requires a country or + for national phone text', () => {
    expect(detect('2133734253', ['phone'])).toEqual([]);
    expect(detect('2133734253', ['phone'], 'US')).toEqual(['phone']);
  });
  it('honors selected categories and checksum', () => {
    expect(detect('test.person@example.com', ['ip'])).toEqual([]);
    expect(luhn('0000000000000000')).toBe(false);
  });
});
