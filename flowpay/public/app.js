import { api, h, METHOD_LABEL, money, show, STATUS_LABEL } from './common.js';

const $ = (id) => document.getElementById(id);
const form = $('req-form');
const openPanels = new Set(); // request ids whose QR/timeline panel is expanded

async function init() {
  const cfg = await api('/api/config');
  $('merchant').textContent = cfg.merchantName;
  $('ai-badge').textContent = cfg.aiEnabled ? '✨ Claude parser' : 'Rule-based parser';
  $('ai-badge').classList.toggle('ai', cfg.aiEnabled);
  await refresh();
}

$('parse-btn').addEventListener('click', async () => {
  const btn = $('parse-btn');
  const text = $('nl').value.trim();
  if (!text) return show($('parse-msg'), 'Type a sentence first, e.g. "Bill Omar 500 USD for consulting".', 'warn');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  try {
    const { fields, warnings, source } = await api('/api/parse', { method: 'POST', body: { text } });
    for (const [k, v] of Object.entries(fields)) if (v != null && form.elements[k]) form.elements[k].value = v;
    const note = `Filled by ${source === 'claude' ? 'Claude' : 'rule-based parser'}. Check the details, then create the link.`;
    show($('parse-msg'), warnings.length ? `${note} ⚠ ${warnings.join('; ')}` : note, warnings.length ? 'warn' : 'ok');
  } catch (e) {
    show($('parse-msg'), e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Fill the form for me';
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  body.splitCount = Number(body.splitCount || 1);
  try {
    const created = await api('/api/requests', { method: 'POST', body });
    show($('form-msg'), '');
    form.reset();
    $('nl').value = '';
    show($('parse-msg'), '');
    openPanels.add(created.id);
    await refresh();
  } catch (err) {
    show($('form-msg'), err.message, 'error');
  }
});

function statTiles(stats) {
  const cur = Object.keys(stats.byCurrency)[0] || 'EGP';
  const c = stats.byCurrency[cur] || { collectedMinor: 0, outstandingMinor: 0 };
  const multi = Object.keys(stats.byCurrency).length > 1 ? ` (+${Object.keys(stats.byCurrency).length - 1} more)` : '';
  const tile = (label, value) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  return [
    tile(`Collected${multi}`, money(c.collectedMinor, cur)),
    tile('Outstanding', money(c.outstandingMinor, cur)),
    tile('Requests', `${stats.paid}/${stats.requests} paid`),
    tile('Rescued payments', String(stats.rescuedPayments)),
  ];
}

const EVENT_TEXT = {
  created: (e) => `Request created${e.splitCount > 1 ? `, split into ${e.splitCount}` : ''}`,
  payment_declined: (e) => `Share ${e.shareIndex + 1}: ${METHOD_LABEL[e.method]} declined (${e.code.replace(/_/g, ' ')})`,
  payment_succeeded: (e) => `Share ${e.shareIndex + 1}: paid by ${METHOD_LABEL[e.method]} · ${e.reference}${e.rescued ? ' · rescued ✨' : ''}`,
  reminder_sent: (e) => `Reminder sent via ${e.channel} (${e.unpaidShares} unpaid)`,
  request_paid: () => 'Fully paid 🎉',
};

function requestCard(r) {
  const pct = Math.round((r.paidMinor / r.amountMinor) * 100);
  const paidShares = r.shares.filter((s) => s.status === 'paid').length;
  const isOpen = openPanels.has(r.id);
  const toggle = () => { isOpen ? openPanels.delete(r.id) : openPanels.add(r.id); refresh(); };

  const copyBtn = h('button', { class: 'ghost', onclick: async () => {
    await navigator.clipboard?.writeText(r.payUrl).catch(() => {});
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500);
  } }, 'Copy link');

  return h('div', { class: 'req' },
    h('div', { class: 'req-head' },
      h('div', {},
        h('div', {}, h('strong', {}, r.payerName), r.description ? h('span', { class: 'muted' }, ` · ${r.description}`) : null),
        h('div', { class: 'small muted' },
          r.shares.length > 1 ? `${paidShares}/${r.shares.length} shares paid` : 'Single payer',
          r.dueDate ? ` · due ${r.dueDate}` : ''),
      ),
      h('div', { style: 'text-align:right' },
        h('div', { class: 'req-amount' }, money(r.amountMinor, r.currency)),
        h('span', { class: `badge ${r.status}` }, STATUS_LABEL[r.status]),
      ),
    ),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Amount collected' },
      h('span', { style: `width:${pct}%` })),
    h('div', { class: 'req-actions' },
      h('a', { href: `/pay/${r.id}`, target: '_blank', rel: 'noopener' }, h('button', { class: 'ghost', tabindex: -1 }, 'Open checkout ↗')),
      copyBtn,
      h('button', { class: 'ghost', onclick: toggle, 'aria-expanded': String(isOpen) }, isOpen ? 'Hide details' : 'QR & activity'),
      r.status !== 'paid' ? h('button', { class: 'ghost', onclick: async () => { await api(`/api/requests/${r.id}/remind`, { method: 'POST', body: { channel: 'whatsapp' } }); openPanels.add(r.id); refresh(); } }, 'Send reminder') : null,
    ),
    isOpen ? h('div', {},
      h('div', { class: 'qr' },
        h('img', { src: `/api/requests/${r.id}/qr`, alt: `QR code for paying ${r.payerName}` }),
        h('div', { class: 'small' }, h('div', { class: 'muted' }, 'Payment link'), h('div', { class: 'mono' }, r.payUrl)),
      ),
      h('ol', { class: 'timeline' }, [...r.events].reverse().map((e) =>
        h('li', {}, `${new Date(e.at).toLocaleString()} — ${(EVENT_TEXT[e.type] || (() => e.type))(e)}`))),
    ) : null,
  );
}

async function refresh() {
  const { requests, stats } = await api('/api/requests');
  $('stats').replaceChildren(...statTiles(stats));
  $('list').replaceChildren(
    ...(requests.length ? requests.map(requestCard) : [h('div', { class: 'empty' }, 'No requests yet. Describe one on the left and FlowPay will build the link.')]),
  );
}

// Keep the dashboard live while customers pay in another tab.
setInterval(() => document.visibilityState === 'visible' && refresh().catch(() => {}), 5000);
init();
