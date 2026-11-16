// Money helpers. All amounts are stored as integer minor units (e.g. piasters/cents)
// so splitting and fees never lose or invent money through floating-point rounding.

export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'];

export function toMinor(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Amount must be a positive number');
  return Math.round(n * 100);
}

export function fromMinor(minor) {
  return minor / 100;
}

export function formatMoney(minor, currency) {
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Split `totalMinor` into `parts` integer shares that sum exactly to the total. */
export function splitMinor(totalMinor, parts) {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('Split count must be a positive integer');
  if (parts > totalMinor) throw new Error('Too many shares for this amount');
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}
