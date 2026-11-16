import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { createStore } from './store.js';
import { createRequestService, NotFoundError, ValidationError } from './requests.js';
import { hasClaude, parseInstruction } from './parser.js';
import { INSTALLMENT_PLANS, installmentQuote } from './processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store = createStore(), parse = parseInstruction, merchantName = 'Demo Merchant' } = {}) {
  const service = createRequestService(store);
  const app = express();
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

  app.get('/api/config', (req, res) => {
    res.json({ merchantName, aiEnabled: hasClaude(), installmentPlans: Object.values(INSTALLMENT_PLANS) });
  });

  app.post('/api/parse', async (req, res) => {
    res.json(await parse(String(req.body?.text ?? '')));
  });

  app.get('/api/requests', (req, res) => {
    const requests = service.list().map((r) => ({ ...r, payUrl: `${baseUrl(req)}/pay/${r.id}` }));
    res.json({ requests, stats: service.stats() });
  });

  app.post('/api/requests', (req, res) => {
    const created = service.create(req.body ?? {});
    res.status(201).json({ ...created, payUrl: `${baseUrl(req)}/pay/${created.id}` });
  });

  app.get('/api/requests/:id', (req, res) => {
    const r = service.get(req.params.id);
    res.json({ ...r, merchantName, payUrl: `${baseUrl(req)}/pay/${r.id}` });
  });

  app.get('/api/requests/:id/qr', async (req, res) => {
    const r = service.get(req.params.id);
    const svg = await QRCode.toString(`${baseUrl(req)}/pay/${r.id}`, { type: 'svg', margin: 1, width: 220 });
    res.type('image/svg+xml').send(svg);
  });

  app.get('/api/requests/:id/installments', (req, res) => {
    const r = service.get(req.params.id);
    const share = r.shares[Number(req.query.share ?? 0)];
    if (!share) throw new ValidationError('Invalid share');
    res.json({ quotes: Object.keys(INSTALLMENT_PLANS).map((m) => installmentQuote(share.amountMinor, Number(m))) });
  });

  app.post('/api/requests/:id/pay', (req, res) => {
    const result = service.pay(req.params.id, req.body ?? {});
    res.status(result.ok ? 200 : 402).json(result);
  });

  app.post('/api/requests/:id/remind', (req, res) => res.json(service.remind(req.params.id, req.body?.channel)));

  app.get('/pay/:id', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pay.html')));

  app.use((err, req, res, _next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.message?.startsWith('Instruction')) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const store = createStore(process.env.FLOWPAY_DB || path.join(__dirname, '..', 'data', 'db.json'));
  createApp({ store, merchantName: process.env.MERCHANT_NAME || 'Demo Merchant' }).listen(port, () => {
    console.log(`FlowPay running at http://localhost:${port}  (AI parser: ${hasClaude() ? 'Claude' : 'rule-based'})`);
  });
}
