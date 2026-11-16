// Turns a merchant's plain-language instruction into payment-request fields.
//
//   "Bill Sara Ahmed 1,200 EGP for website design, split between 3, due Dec 1"
//
// Uses Claude (structured JSON output) when Anthropic credentials are configured,
// and falls back to a deterministic rule-based parser otherwise, so the product
// works offline. The result only PRE-FILLS the form: the merchant always confirms.

import Anthropic from '@anthropic-ai/sdk';
import { CURRENCIES } from './money.js';

const CURRENCY_ALIASES = {
  egp: 'EGP', le: 'EGP', 'l.e': 'EGP', 'e£': 'EGP', pound: 'EGP', pounds: 'EGP', 'جنيه': 'EGP',
  usd: 'USD', $: 'USD', dollar: 'USD', dollars: 'USD',
  eur: 'EUR', '€': 'EUR', euro: 'EUR', euros: 'EUR',
  gbp: 'GBP', '£': 'GBP', sterling: 'GBP',
  sar: 'SAR', riyal: 'SAR', riyals: 'SAR',
  aed: 'AED', dirham: 'AED', dirhams: 'AED',
};

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const isoDate = (d) => d.toISOString().slice(0, 10);

function addDays(base, days) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Parse a loose due-date phrase relative to `today` (a Date at UTC midnight). */
export function parseDueDate(phrase, today) {
  const p = phrase.trim().toLowerCase().replace(/^(on|by)\s+/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  if (p === 'today') return isoDate(today);
  if (p === 'tomorrow') return isoDate(addDays(today, 1));
  if (p === 'next week') return isoDate(addDays(today, 7));
  if (p === 'end of month' || p === 'end of the month') {
    return isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));
  }
  let m = p.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/);
  if (m) return isoDate(addDays(today, Number(m[1]) * (m[2].startsWith('week') ? 7 : 1)));
  m = p.match(/^(?:next\s+)?([a-z]+)$/);
  if (m && WEEKDAYS.includes(m[1])) {
    const delta = (WEEKDAYS.indexOf(m[1]) - today.getUTCDay() + 7) % 7 || 7;
    return isoDate(addDays(today, delta));
  }
  // "Dec 1", "december 1st", "1 Dec"
  m = p.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/) || p.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*$/);
  if (m) {
    const [monStr, dayStr] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const month = MONTHS.indexOf(monStr);
    if (month >= 0) {
      let d = new Date(Date.UTC(today.getUTCFullYear(), month, Number(dayStr)));
      if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, month, Number(dayStr)));
      return isoDate(d);
    }
  }
  return null;
}

export function ruleParse(text, today = todayUtc()) {
  const fields = { payerName: '', amount: null, currency: 'EGP', description: '', splitCount: 1, dueDate: '' };
  const warnings = [];
  const src = text.trim();

  // Amount with an optional currency before or after it.
  const cur = '(\\$|€|£|e£|egp|usd|eur|gbp|sar|aed|l\\.?e|pounds?|dollars?|euros?|riyals?|dirhams?|جنيه)';
  const num = '(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?\\s*(k\\b)?';
  // Prefer a number attached to a currency ("for 2 lessons, 300 EGP" -> 300); else the first number.
  const am =
    src.match(new RegExp(`${cur}\\s*${num}()`, 'i')) ||
    src.match(new RegExp(`()${num}\\s*${cur}(?![\\p{L}])`, 'iu')) ||
    src.match(new RegExp(`()${num}()`, 'i'));
  if (am) {
    let amount = Number(`${am[2].replace(/,/g, '')}${am[3] ? `.${am[3]}` : ''}`);
    if (am[4]) amount *= 1000;
    fields.amount = amount;
    const c = (am[1] || am[5] || '').toLowerCase();
    if (c) fields.currency = CURRENCY_ALIASES[c] || CURRENCY_ALIASES[c.replace(/\./g, '')] || 'EGP';
  } else {
    warnings.push('No amount found');
  }

  // Payer = the word after the verb, plus a following capitalised word (surname / "Acme Corp").
  const payer = src.match(/\b(?:bill|charge|invoice|request\s+(?:payment\s+)?from|ask|collect\s+from)\s+(\p{L}[\p{L}'-]*)(?:\s+(\p{L}[\p{L}'-]*))?/iu);
  if (payer && !/^(for|the|a|an)$/i.test(payer[1])) {
    const second = payer[2] && /^\p{Lu}/u.test(payer[2]) ? ` ${payer[2]}` : '';
    fields.payerName = payer[1][0].toUpperCase() + payer[1].slice(1) + second;
  } else {
    warnings.push('No payer name found');
  }

  const desc = src.match(/\bfor\s+(?!\d)(.+?)(?=,|;|\s+split\b|\s+due\b|\s+by\s+(?:\d|next|tomorrow|today)|\s+in\s+\d+\s+install|$)/i);
  if (desc) fields.description = desc[1].trim();

  const split = src.match(/\bsplit\s+(?:it\s+)?(?:between|among|into|by|in|across)?\s*(\d+|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (split) fields.splitCount = Number(split[1]) || NUMBER_WORDS[split[1].toLowerCase()];

  const due = src.match(/\bdue\s+(.+?)(?=,|;|$)/i);
  if (due) {
    const d = parseDueDate(due[1], today);
    if (d) fields.dueDate = d;
    else warnings.push(`Could not understand due date "${due[1]}"`);
  } else {
    // "by Friday" / "before Dec 1": only accepted when it really is a date (not "split by 3").
    const loose = src.match(/\b(?:by|before)\s+(.+?)(?=,|;|$)/i);
    const d = loose && parseDueDate(loose[1], today);
    if (d) fields.dueDate = d;
  }
  return { fields, warnings, source: 'rules' };
}

// ---------- Claude-powered parser ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['payerName', 'amount', 'currency', 'description', 'splitCount', 'dueDate'],
  properties: {
    payerName: { type: 'string', description: 'Person or company being charged; empty string if not stated' },
    amount: { type: 'number', description: 'Total amount in major units (e.g. 1200.50); 0 if not stated' },
    currency: { type: 'string', enum: CURRENCIES },
    description: { type: 'string', description: 'What the payment is for; empty string if not stated' },
    splitCount: { type: 'integer', description: 'Number of people splitting the bill; 1 if not split' },
    dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD, or empty string if not stated' },
  },
};

let client;
export function hasClaude() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function claudeParse(text, today = todayUtc()) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: process.env.FLOWPAY_MODEL || 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system:
      'You extract payment-request fields from a merchant instruction for a payments app. ' +
      `Today is ${isoDate(today)} (resolve relative dates against it). Default currency is EGP when none is given. ` +
      'Never invent a payer or amount that is not in the text.',
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Model declined the request');
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No structured output returned');
  const out = JSON.parse(textBlock.text);
  const fields = {
    payerName: out.payerName || '',
    amount: out.amount > 0 ? out.amount : null,
    currency: CURRENCIES.includes(out.currency) ? out.currency : 'EGP',
    description: out.description || '',
    splitCount: Math.max(1, Math.min(50, out.splitCount || 1)),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(out.dueDate) ? out.dueDate : '',
  };
  const warnings = [];
  if (!fields.amount) warnings.push('No amount found');
  if (!fields.payerName) warnings.push('No payer name found');
  return { fields, warnings, source: 'claude' };
}

export async function parseInstruction(text, { useClaude = hasClaude(), today = todayUtc() } = {}) {
  if (!text || !text.trim()) throw new Error('Instruction text is required');
  if (text.length > 1000) throw new Error('Instruction is too long (max 1000 characters)');
  if (useClaude) {
    try {
      return await claudeParse(text, today);
    } catch (err) {
      const result = ruleParse(text, today);
      result.warnings.unshift(`AI parser unavailable (${err.message}); used rule-based parser`);
      return result;
    }
  }
  return ruleParse(text, today);
}

export function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
