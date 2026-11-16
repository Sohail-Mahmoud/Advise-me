// Payment-request service: creation, splitting, status, payments, reminders and the event log.

import crypto from 'node:crypto';
import { CURRENCIES, splitMinor, toMinor } from './money.js';
import { processPayment } from './processor.js';

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const newId = () => `req_${crypto.randomBytes(6).toString('base64url')}`;

export function createRequestService(store, { now = () => new Date() } = {}) {
  function event(req, type, data = {}) {
    req.events.push({ at: now().toISOString(), type, ...data });
  }

  function load(id) {
    const req = store.get(id);
    if (!req) throw new NotFoundError('Payment request not found');
    return req;
  }

  function create(input) {
    const payerName = String(input.payerName || '').trim();
    const description = String(input.description || '').trim();
    const currency = String(input.currency || 'EGP').toUpperCase();
    const splitCount = Number(input.splitCount || 1);
    const dueDate = input.dueDate ? String(input.dueDate) : '';

    if (!payerName) throw new ValidationError('Payer name is required');
    if (payerName.length > 80) throw new ValidationError('Payer name is too long');
    if (description.length > 200) throw new ValidationError('Description is too long');
    if (!CURRENCIES.includes(currency)) throw new ValidationError(`Currency must be one of ${CURRENCIES.join(', ')}`);
    if (!Number.isInteger(splitCount) || splitCount < 1 || splitCount > 50) throw new ValidationError('Split must be between 1 and 50 people');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new ValidationError('Due date must be YYYY-MM-DD');

    let amountMinor;
    try {
      amountMinor = toMinor(input.amount);
    } catch (e) {
      throw new ValidationError(e.message);
    }
    if (amountMinor > 100_000_000) throw new ValidationError('Amount exceeds the 1,000,000 limit');
    if (splitCount > amountMinor) throw new ValidationError('Too many shares for this amount');

    const req = {
      id: newId(),
      payerName,
      description,
      currency,
      amountMinor,
      dueDate,
      createdAt: now().toISOString(),
      shares: splitMinor(amountMinor, splitCount).map((amt, index) => ({ index, amountMinor: amt, status: 'unpaid' })),
      events: [],
      rescued: 0,
    };
    event(req, 'created', { amountMinor, splitCount });
    store.put(req);
    return view(req);
  }

  function statusOf(req) {
    const paid = req.shares.filter((s) => s.status === 'paid').length;
    if (paid === req.shares.length) return 'paid';
    const today = now().toISOString().slice(0, 10);
    if (req.dueDate && req.dueDate < today) return 'overdue';
    return paid > 0 ? 'partially_paid' : 'pending';
  }

  function view(req) {
    const paidMinor = req.shares.filter((s) => s.status === 'paid').reduce((a, s) => a + s.amountMinor, 0);
    return { ...req, status: statusOf(req), paidMinor, outstandingMinor: req.amountMinor - paidMinor };
  }

  function pay(id, { shareIndex = 0, method, details } = {}) {
    const req = load(id);
    const share = req.shares[Number(shareIndex)];
    if (!share) throw new ValidationError('Invalid share');
    if (share.status === 'paid') throw new ValidationError('This share is already paid');

    const result = processPayment({ method, amountMinor: share.amountMinor, details }, now());
    if (!result.ok) {
      if (result.code === 'invalid_details' || result.code === 'invalid_method') throw new ValidationError(result.message);
      share.lastDecline = result.code;
      event(req, 'payment_declined', { shareIndex: share.index, method, code: result.code });
      store.put(req);
      return { ok: false, code: result.code, message: result.message, rescue: result.rescue, request: view(req) };
    }

    // A payment that succeeds after a decline on the same share counts as a rescued sale.
    const rescued = Boolean(share.lastDecline);
    Object.assign(share, { status: 'paid', method, reference: result.reference, paidAt: now().toISOString(), rescued, details: result.details });
    delete share.lastDecline;
    if (rescued) req.rescued += 1;
    event(req, 'payment_succeeded', { shareIndex: share.index, method, reference: result.reference, rescued });
    if (statusOf(req) === 'paid') event(req, 'request_paid');
    store.put(req);
    return { ok: true, reference: result.reference, share, request: view(req) };
  }

  function remind(id, channel = 'whatsapp') {
    const req = load(id);
    if (statusOf(req) === 'paid') throw new ValidationError('Request is already fully paid');
    if (!['whatsapp', 'sms', 'email'].includes(channel)) throw new ValidationError('Unknown reminder channel');
    const unpaid = req.shares.filter((s) => s.status !== 'paid').length;
    event(req, 'reminder_sent', { channel, unpaidShares: unpaid });
    store.put(req);
    return view(req);
  }

  function list() {
    return store.all().map(view);
  }

  function stats() {
    const all = list();
    const byCurrency = {};
    for (const r of all) {
      const c = (byCurrency[r.currency] ??= { collectedMinor: 0, outstandingMinor: 0 });
      c.collectedMinor += r.paidMinor;
      c.outstandingMinor += r.outstandingMinor;
    }
    return {
      requests: all.length,
      paid: all.filter((r) => r.status === 'paid').length,
      overdue: all.filter((r) => r.status === 'overdue').length,
      rescuedPayments: all.reduce((a, r) => a + r.rescued, 0),
      byCurrency,
    };
  }

  return { create, get: (id) => view(load(id)), pay, remind, list, stats };
}
