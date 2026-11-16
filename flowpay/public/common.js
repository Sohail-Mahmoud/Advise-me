// Shared browser helpers. h() builds DOM with textContent only, so user-entered
// strings (payer names, descriptions) can never inject HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const money = (minor, currency) =>
  `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export const STATUS_LABEL = { paid: 'Paid', partially_paid: 'Partially paid', pending: 'Awaiting payment', overdue: 'Overdue' };
export const METHOD_LABEL = { card: 'Card', wallet: 'Mobile wallet', bank_transfer: 'Bank transfer', installments: 'Installments' };

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function show(el, text, kind) {
  el.textContent = text;
  if (kind) el.className = `msg ${kind}`;
  el.classList.toggle('hidden', !text);
}
