import { isIP } from 'node:net';
import isEmail from 'validator/lib/isEmail';
import isIBAN from 'validator/lib/isIBAN';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js/max';
import { Category } from './guard.constants';

export function luhn(value: string): boolean {
  if (!/^\d{13,19}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  for (
    let i = value.length - 1, double = false;
    i >= 0;
    i--, double = !double
  ) {
    let digit = Number(value[i]);
    if (double) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
}

// Only typed text is pattern-scanned; Excel numbers can be rounded order IDs.
// Each bounded token/candidate is validated, never returned or retained.
export function detect(
  text: string,
  categories: Category[],
  region?: string,
): Category[] {
  const found = new Set<Category>();
  const enabled = new Set(categories);
  const tokens = text.split(/[\s,;<>"'()]+/).slice(0, 2048);
  for (const token of tokens) {
    if (token.length > 254) continue;
    const clean = token.replace(/^[[{]+|[\]}.!?]+$/g, '');
    if (enabled.has('email') && isEmail(clean)) found.add('email');
    if (enabled.has('ip') && isIP(clean)) found.add('ip');
  }
  if (enabled.has('iban')) {
    const candidates =
      text.match(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi) ?? [];
    for (const candidate of candidates.slice(0, 100)) {
      for (let end = 15; end <= candidate.length; end++) {
        if (
          (end === candidate.length || candidate[end] === ' ') &&
          isIBAN(candidate.slice(0, end))
        ) {
          found.add('iban');
          break;
        }
      }
    }
  }
  if (enabled.has('payment_card') || enabled.has('phone')) {
    const candidates =
      text.match(/(?:^|[^\p{L}\d])\+?\d(?:[\d ()-]{4,32}\d)(?![\p{L}\d])/gu) ??
      [];
    for (const raw of candidates.slice(0, 100)) {
      const candidate = raw.trim().replace(/^[^+\d]+/, '');
      const digits = candidate.replace(/\D/g, '');
      if (
        enabled.has('payment_card') &&
        !candidate.startsWith('+') &&
        luhn(digits)
      )
        found.add('payment_card');
      if (
        enabled.has('phone') &&
        (candidate.startsWith('+') || region) &&
        digits.length >= 7 &&
        digits.length <= 15
      ) {
        const phone = parsePhoneNumberFromString(
          candidate,
          region as CountryCode | undefined,
        );
        if (phone?.isValid()) found.add('phone');
      }
    }
  }
  return [...found].sort();
}
