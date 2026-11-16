import { api, h, METHOD_LABEL, money, show } from './common.js';

const id = location.pathname.split('/').pop();
const root = document.getElementById('root');
const METHOD_ICON = { card: '💳', wallet: '📱', bank_transfer: '🏦', installments: '🗓️' };

const state = { req: null, shareIndex: 0, method: 'card', months: 3, quotes: [], decline: null, success: null, busy: false, error: '' };

async function load() {
  try {
    state.req = await api(`/api/requests/${id}`);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Link not found'), h('p', { class: 'muted' }, e.message)));
    return;
  }
  const firstUnpaid = state.req.shares.find((s) => s.status !== 'paid');
  state.shareIndex = firstUnpaid ? firstUnpaid.index : 0;
  await loadQuotes();
  render();
}

async function loadQuotes() {
  state.quotes = (await api(`/api/requests/${id}/installments?share=${state.shareIndex}`)).quotes;
}

const share = () => state.req.shares[state.shareIndex];

function field(label, attrs) {
  const inputId = `f-${attrs.name}`;
  return h('div', {}, h('label', { for: inputId }, label), h('input', { id: inputId, ...attrs }));
}

function cardFields() {
  return [
    field('Card number', { name: 'number', inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '4242 4242 4242 4242', required: true }),
    h('div', { class: 'row' },
      field('Expiry', { name: 'expiry', autocomplete: 'cc-exp', placeholder: 'MM/YY', required: true }),
      field('CVC', { name: 'cvc', inputmode: 'numeric', autocomplete: 'cc-csc', placeholder: '123', required: true }),
    ),
  ];
}

function methodForm() {
  const s = share();
  const cur = state.req.currency;
  switch (state.method) {
    case 'card':
      return cardFields();
    case 'wallet':
      return [field('Wallet phone number', { name: 'phone', inputmode: 'tel', autocomplete: 'tel', placeholder: '010 1234 5678', required: true }),
        h('p', { class: 'small muted' }, 'You will approve the payment in your wallet app.')];
    case 'bank_transfer':
      return [field('Account holder name', { name: 'accountName', autocomplete: 'name', required: true }),
        h('p', { class: 'small muted' }, 'Instant transfer: confirmed in seconds, no card needed.')];
    case 'installments':
      return [
        h('div', { class: 'plans', role: 'group', 'aria-label': 'Installment plan' }, state.quotes.map((q) =>
          h('button', { type: 'button', class: 'plan', 'aria-pressed': String(state.months === q.months), onclick: () => { state.months = q.months; render(); } },
            h('strong', {}, `${q.months} × ${money(q.schedule[0], cur)}`),
            h('span', { class: 'small muted' }, `Total ${money(q.totalMinor, cur)} · ${q.feePct}% fee`)))),
        h('p', { class: 'small muted' }, `Only the first installment is charged today. Share amount: ${money(s.amountMinor, cur)}.`),
        ...cardFields(),
      ];
  }
}

function payLabel() {
  const cur = state.req.currency;
  if (state.method === 'installments') {
    const q = state.quotes.find((x) => x.months === state.months);
    return `Pay ${money(q.schedule[0], cur)} today`;
  }
  return `Pay ${money(share().amountMinor, cur)}`;
}

async function submit(e) {
  e.preventDefault();
  const details = Object.fromEntries(new FormData(e.target));
  if (state.method === 'installments') details.months = state.months;
  state.busy = true;
  state.error = '';
  render();
  try {
    const result = await api(`/api/requests/${id}/pay`, { method: 'POST', body: { shareIndex: state.shareIndex, method: state.method, details } });
    state.req = { ...state.req, ...result.request };
    if (result.ok) {
      state.success = result;
      state.decline = null;
    } else {
      state.decline = result;
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

function switchMethod(m) {
  state.method = m;
  state.error = '';
  render();
  document.querySelector('#pay-form input')?.focus();
}

function render() {
  const r = state.req;
  const cur = r.currency;

  if (state.success) {
    const s = state.success.share;
    const remaining = r.shares.filter((x) => x.status !== 'paid');
    root.replaceChildren(h('div', { class: 'card success stack' },
      h('div', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
      h('h2', {}, 'Payment successful'),
      h('div', { class: 'summary' }, h('div', { class: 'amount' }, money(s.amountMinor, cur))),
      h('p', { class: 'muted' }, `Paid to ${r.merchantName} by ${METHOD_LABEL[s.method]}`,
        s.details?.plan ? ` · ${s.details.plan.months} monthly installments` : ''),
      h('p', { class: 'mono small' }, `Reference ${s.reference}`),
      s.rescued ? h('div', { class: 'msg ok' }, 'Saved by FlowPay rescue: your first attempt failed, but you got through another way.') : null,
      remaining.length ? h('button', { class: 'secondary', onclick: async () => {
        state.success = null; state.shareIndex = remaining[0].index; await loadQuotes(); render();
      } }, `Pay another share (${remaining.length} left)`) : h('p', { class: 'muted small' }, 'This bill is now fully paid. You can close this page.'),
    ));
    return;
  }

  if (r.status === 'paid') {
    root.replaceChildren(h('div', { class: 'card success' }, h('div', { class: 'tick' }, '✓'), h('h2', {}, 'Already paid'),
      h('p', { class: 'muted' }, `This request from ${r.merchantName} has been fully paid. Thank you!`)));
    return;
  }

  const summary = h('div', { class: 'card summary' },
    h('div', { class: 'muted small' }, `${r.merchantName} requests`),
    h('div', { class: 'amount' }, money(share().amountMinor, cur)),
    h('div', {}, r.description || 'Payment', h('span', { class: 'muted' }, ` · for ${r.payerName}`)),
    r.shares.length > 1 ? h('div', { class: 'small muted' }, `Your share of ${money(r.amountMinor, cur)} split ${r.shares.length} ways`) : null,
    r.dueDate ? h('div', { class: 'small muted' }, `Due ${r.dueDate}`) : null,
  );

  const shares = r.shares.length > 1 ? h('div', { class: 'card stack' },
    h('h2', {}, 'Which share are you paying?'),
    h('div', { class: 'shares', role: 'group' }, r.shares.map((s) =>
      h('button', { type: 'button', class: 'share-btn', disabled: s.status === 'paid', 'aria-pressed': String(s.index === state.shareIndex),
        onclick: async () => { state.shareIndex = s.index; state.decline = null; await loadQuotes(); render(); } },
      `Share ${s.index + 1} · ${money(s.amountMinor, cur)}${s.status === 'paid' ? ' (paid)' : ''}`))),
  ) : null;

  const rescue = state.decline ? h('div', { class: 'rescue', role: 'alert' },
    h('h3', {}, `${state.decline.message}`),
    h('div', { class: 'small' }, 'No problem. Here’s the quickest way to finish:'),
    state.decline.rescue.map((opt, i) => h('div', { class: 'rescue-opt' },
      h('div', {}, h('strong', {}, `${METHOD_ICON[opt.method]} ${METHOD_LABEL[opt.method]}`), h('div', { class: 'small muted' }, opt.reason)),
      h('button', { class: i === 0 ? '' : 'secondary', onclick: () => { state.decline = null; switchMethod(opt.method); } }, 'Use this'))),
  ) : null;

  const methods = h('div', { class: 'methods', role: 'group', 'aria-label': 'Payment method' },
    Object.keys(METHOD_LABEL).map((m) => h('button', { type: 'button', class: 'method', 'aria-pressed': String(state.method === m), onclick: () => switchMethod(m) },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, METHOD_ICON[m]), METHOD_LABEL[m])));

  const errorBox = h('div', { class: 'msg error hidden', role: 'alert' });
  show(errorBox, state.error, 'error');

  const payForm = h('form', { id: 'pay-form', class: 'card stack', onsubmit: submit, novalidate: true },
    h('h2', {}, 'Pay with'),
    methods,
    ...methodForm(),
    errorBox,
    h('button', { type: 'submit', class: 'block', disabled: state.busy }, state.busy ? 'Processing…' : payLabel()),
    h('details', { class: 'testdata' }, h('summary', {}, 'Demo test data'),
      h('p', {}, 'Approved: ', h('code', {}, '4242 4242 4242 4242'), ', any future expiry, any CVC.'),
      h('p', {}, 'Insufficient funds: ', h('code', {}, '4000 0000 0000 9995'), '. Blocked by bank: ', h('code', {}, '4000 0000 0000 0002'), '.'),
      h('p', {}, 'Wallet limit reached: any number ending in ', h('code', {}, '0000'), '.')),
  );

  // Carry typed values across re-renders (e.g. card -> installments rescue keeps the card number).
  const prev = document.getElementById('pay-form');
  const typed = prev ? Object.fromEntries(new FormData(prev)) : {};
  for (const [name, value] of Object.entries(typed)) if (payForm.elements[name]) payForm.elements[name].value = value;

  root.replaceChildren(summary, shares ?? '', rescue ?? '', payForm);
}

load();
