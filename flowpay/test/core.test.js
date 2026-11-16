import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMinor, toMinor } from '../src/money.js';
import { parseDueDate, parseInstruction, ruleParse } from '../src/parser.js';
import { installmentQuote, luhnValid, processPayment } from '../src/processor.js';
import { createStore } from '../src/store.js';
import { createRequestService, ValidationError } from '../src/requests.js';

const TODAY = new Date(Date.UTC(2026, 10, 16)); // Monday 2026-11-16
const NOW = new Date('2026-11-16T10:00:00Z');
const GOOD_CARD = { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' };

test('splitMinor distributes remainder without losing money', () => {
  assert.deepEqual(splitMinor(100000, 3), [33334, 33333, 33333]);
  assert.equal(splitMinor(100001, 7).reduce((a, b) => a + b), 100001);
  assert.throws(() => splitMinor(2, 3));
  assert.equal(toMinor('10.105'), 1011);
});

test('rule parser extracts payer, amount, currency, description, split, due date', () => {
  const { fields } = ruleParse('Bill Sara Ahmed 1,200 EGP for website design, split between 3, due Dec 1', TODAY);
  assert.deepEqual(fields, {
    payerName: 'Sara Ahmed', amount: 1200, currency: 'EGP', description: 'website design', splitCount: 3, dueDate: '2026-12-01',
  });
});

test('rule parser handles symbols, k suffix, weekdays, and number words', () => {
  let { fields } = ruleParse('Charge Omar $2.5k for consulting due friday', TODAY);
  assert.equal(fields.amount, 2500);
  assert.equal(fields.currency, 'USD');
  assert.equal(fields.dueDate, '2026-11-20');
  ({ fields } = ruleParse('invoice Acme 750.50 eur for hosting, split in two, due in 2 weeks', TODAY));
  assert.equal(fields.amount, 750.5);
  assert.equal(fields.currency, 'EUR');
  assert.equal(fields.splitCount, 2);
  assert.equal(fields.dueDate, '2026-11-30');
  ({ fields } = ruleParse('Bill Mona for 2 lessons, 300 EGP, split by 2', TODAY));
  assert.equal(fields.amount, 300);
  assert.equal(fields.splitCount, 2);
  assert.equal(fields.dueDate, '');
});

test('due date parsing rolls past dates into next year', () => {
  assert.equal(parseDueDate('Jan 5', TODAY), '2027-01-05');
  assert.equal(parseDueDate('end of month', TODAY), '2026-11-30');
  assert.equal(parseDueDate('gibberish', TODAY), null);
});

test('parseInstruction falls back to rules when the AI parser fails', async () => {
  const r = await parseInstruction('Bill Ali 100 USD for lunch', { useClaude: false, today: TODAY });
  assert.equal(r.source, 'rules');
  await assert.rejects(parseInstruction('   ', { useClaude: false }));
});

test('card validation and test-card outcomes', () => {
  assert.ok(luhnValid('4242424242424242'));
  assert.ok(!luhnValid('4242424242424241'));
  assert.equal(processPayment({ method: 'card', amountMinor: 1000, details: GOOD_CARD }, NOW).ok, true);
  assert.equal(processPayment({ method: 'card', amountMinor: 1000, details: { ...GOOD_CARD, expiry: '10/26' } }, NOW).message, 'Card has expired');

  const insufficient = processPayment({ method: 'card', amountMinor: 1000, details: { ...GOOD_CARD, number: '4000000000009995' } }, NOW);
  assert.equal(insufficient.code, 'insufficient_funds');
  assert.equal(insufficient.rescue[0].method, 'installments');

  // The rescue works: installments only charge the first payment today.
  const viaInstallments = processPayment({ method: 'installments', amountMinor: 1000, details: { ...GOOD_CARD, number: '4000000000009995', months: 3 } }, NOW);
  assert.equal(viaInstallments.ok, true);

  const blocked = processPayment({ method: 'card', amountMinor: 1000, details: { ...GOOD_CARD, number: '4000000000000002' } }, NOW);
  assert.deepEqual(blocked.rescue.map((r) => r.method), ['wallet', 'bank_transfer']);

  const wallet = processPayment({ method: 'wallet', amountMinor: 1000, details: { phone: '01012340000' } }, NOW);
  assert.deepEqual(wallet.rescue.map((r) => r.method), ['card', 'bank_transfer']);
});

test('installment quote adds fee and schedule sums to total', () => {
  const q = installmentQuote(100000, 6);
  assert.equal(q.feeMinor, 5000);
  assert.equal(q.schedule.reduce((a, b) => a + b), q.totalMinor);
  assert.throws(() => installmentQuote(1000, 4));
});

test('request lifecycle: split, decline, rescue, paid, reminders', () => {
  const svc = createRequestService(createStore(), { now: () => NOW });
  const req = svc.create({ payerName: 'Sara', amount: 1000, currency: 'egp', description: 'Design', splitCount: 2 });
  assert.equal(req.status, 'pending');
  assert.deepEqual(req.shares.map((s) => s.amountMinor), [50000, 50000]);

  const declined = svc.pay(req.id, { shareIndex: 0, method: 'card', details: { ...GOOD_CARD, number: '4000000000009995' } });
  assert.equal(declined.ok, false);

  const rescued = svc.pay(req.id, { shareIndex: 0, method: 'installments', details: { ...GOOD_CARD, number: '4000000000009995', months: 3 } });
  assert.equal(rescued.ok, true);
  assert.equal(rescued.share.rescued, true);
  assert.equal(rescued.request.status, 'partially_paid');

  assert.throws(() => svc.pay(req.id, { shareIndex: 0, method: 'card', details: GOOD_CARD }), ValidationError);
  svc.remind(req.id, 'sms');

  const done = svc.pay(req.id, { shareIndex: 1, method: 'bank_transfer', details: { accountName: 'Ali' } });
  assert.equal(done.request.status, 'paid');
  assert.throws(() => svc.remind(req.id), ValidationError);

  const stats = svc.stats();
  assert.equal(stats.rescuedPayments, 1);
  assert.equal(stats.byCurrency.EGP.collectedMinor, 100000);
  assert.deepEqual(svc.get(req.id).events.map((e) => e.type),
    ['created', 'payment_declined', 'payment_succeeded', 'reminder_sent', 'payment_succeeded', 'request_paid']);
});

test('validation and overdue status', () => {
  const svc = createRequestService(createStore(), { now: () => NOW });
  assert.throws(() => svc.create({ amount: 10 }), /Payer name/);
  assert.throws(() => svc.create({ payerName: 'A', amount: -5 }), /positive/);
  assert.throws(() => svc.create({ payerName: 'A', amount: 10, currency: 'XYZ' }), /Currency/);
  const r = svc.create({ payerName: 'A', amount: 10, dueDate: '2026-11-01' });
  assert.equal(r.status, 'overdue');
});
