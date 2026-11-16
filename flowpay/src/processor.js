// Simulated payment rails. In production each method maps to a real provider adapter
// (card acquirer with tokenized fields, wallet API, instant bank-transfer rail, BNPL partner).
// Nothing here moves real money.
//
// Test data:
//   Card 4242 4242 4242 4242  -> approved
//   Card 4000 0000 0000 9995  -> declined: insufficient funds   (rescue: installments)
//   Card 4000 0000 0000 0002  -> declined: card blocked by bank (rescue: wallet / bank transfer)
//   Wallet number ending 0000 -> declined: wallet limit reached (rescue: card / bank transfer)

import crypto from 'node:crypto';

export const METHODS = ['card', 'wallet', 'bank_transfer', 'installments'];

export const INSTALLMENT_PLANS = {
  3: { months: 3, feePct: 3 },
  6: { months: 6, feePct: 5 },
};

const DECLINES = {
  insufficient_funds: 'Your card has insufficient funds for this payment.',
  card_declined: 'Your bank declined this card for online payments.',
  wallet_limit: 'This wallet has reached its daily spending limit.',
};

// Best alternative for each failure, in priority order. This is the "smart rescue".
const RESCUE = {
  insufficient_funds: [
    { method: 'installments', reason: 'Spread it over 3 or 6 months; only the first installment is charged today.' },
    { method: 'bank_transfer', reason: 'Pay straight from your bank account.' },
  ],
  card_declined: [
    { method: 'wallet', reason: 'Pay instantly from your mobile wallet.' },
    { method: 'bank_transfer', reason: 'Pay straight from your bank account.' },
  ],
  wallet_limit: [
    { method: 'card', reason: 'Pay with any debit or credit card.' },
    { method: 'bank_transfer', reason: 'Bank transfers are not subject to wallet limits.' },
  ],
};

export function luhnValid(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateCard({ number, expiry, cvc } = {}, now = new Date()) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!luhnValid(digits)) return 'Card number is not valid';
  const m = String(expiry || '').match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return 'Expiry must be MM/YY';
  const expEnd = new Date(Date.UTC(2000 + Number(m[2]), Number(m[1]), 1)); // first day after expiry month
  if (expEnd <= now) return 'Card has expired';
  if (!/^\d{3,4}$/.test(String(cvc || ''))) return 'CVC must be 3 or 4 digits';
  return null;
}

function cardOutcome(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits === '4000000000009995') return 'insufficient_funds';
  if (digits === '4000000000000002') return 'card_declined';
  return null;
}

export function installmentQuote(amountMinor, months) {
  const plan = INSTALLMENT_PLANS[months];
  if (!plan) throw new Error('Installment plan must be 3 or 6 months');
  const feeMinor = Math.round((amountMinor * plan.feePct) / 100);
  const totalMinor = amountMinor + feeMinor;
  const base = Math.floor(totalMinor / months);
  const schedule = Array.from({ length: months }, (_, i) => base + (i < totalMinor - base * months ? 1 : 0));
  return { months, feePct: plan.feePct, feeMinor, totalMinor, schedule };
}

const reference = () => `FP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

function decline(code, method) {
  return {
    ok: false,
    code,
    message: DECLINES[code],
    rescue: RESCUE[code].filter((r) => r.method !== method),
  };
}

/**
 * Process one payment attempt.
 * @returns {{ok:true, reference, method, details} | {ok:false, code, message, rescue?}}
 */
export function processPayment({ method, amountMinor, details = {} }, now = new Date()) {
  if (!METHODS.includes(method)) return { ok: false, code: 'invalid_method', message: 'Unsupported payment method' };

  if (method === 'card' || method === 'installments') {
    const err = validateCard(details, now);
    if (err) return { ok: false, code: 'invalid_details', message: err };
    const last4 = String(details.number).replace(/\D/g, '').slice(-4);
    let plan;
    if (method === 'installments') {
      try {
        plan = installmentQuote(amountMinor, Number(details.months));
      } catch (e) {
        return { ok: false, code: 'invalid_details', message: e.message };
      }
    }
    const outcome = cardOutcome(details.number);
    // An installment plan only charges the first installment today, which is what
    // rescues "insufficient funds"; a card blocked by the bank fails either way.
    if (outcome === 'card_declined' || (outcome === 'insufficient_funds' && method === 'card')) {
      return decline(outcome, method);
    }
    return { ok: true, reference: reference(), method, details: { last4, ...(plan && { plan }) } };
  }

  if (method === 'wallet') {
    const phone = String(details.phone || '').replace(/[\s-]/g, '');
    if (!/^\+?\d{10,15}$/.test(phone)) return { ok: false, code: 'invalid_details', message: 'Enter a valid wallet phone number' };
    if (phone.endsWith('0000')) return decline('wallet_limit', method);
    return { ok: true, reference: reference(), method, details: { phone: `•••${phone.slice(-3)}` } };
  }

  // bank_transfer: simulated instant transfer (e.g. InstaPay / Open Banking) confirmed immediately.
  const name = String(details.accountName || '').trim();
  if (name.length < 2) return { ok: false, code: 'invalid_details', message: 'Enter the account holder name' };
  return { ok: true, reference: reference(), method, details: { accountName: name } };
}
