# FlowPay (MVP)

**Smart payment requests:** one link, every payment method, split bills, installments, and automatic rescue of failed payments.
The full product plan is in [`../docs/PRODUCT_PLAN.md`](../docs/PRODUCT_PLAN.md).

> ⚠️ Demo only: the payment rails are **simulated**. No real money moves, and no card data is stored.

## Run it

```bash
cd flowpay
npm install
npm start            # http://localhost:3000
npm test             # unit + service tests
```

Optional: `export ANTHROPIC_API_KEY=...` before `npm start` turns on the **Claude-powered** natural-language parser
(model `claude-opus-5-5`, structured JSON output, server-side refusal fallback enabled).
Without a key, a built-in rule-based parser is used.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MERCHANT_NAME` | `Demo Merchant` | Name shown on checkout |
| `FLOWPAY_DB` | `data/db.json` | JSON storage file |
| `PUBLIC_URL` | request host | Base URL used in pay links and QR codes |
| `FLOWPAY_MODEL` | `claude-opus-5-5` | Claude model for parsing |

## Try the demo flow

1. On the dashboard, type: *Bill Sara Ahmed 1,200 EGP for website design, split between 3, due Dec 1*, then click **Fill the form for me**, then **Create payment link**.
2. Click **Open checkout** (or scan the QR code). Pay with card `4000 0000 0000 9995` (insufficient funds).
3. FlowPay suggests **Installments**. Click **Use this**, and the card details are kept. Pay, and the payment is rescued.
4. Back on the dashboard, you'll see the progress bar, status, the "Rescued payments" counter and the activity timeline.

| Test data | Result |
|---|---|
| Card `4242 4242 4242 4242` | Approved |
| Card `4000 0000 0000 9995` | Insufficient funds → suggests installments / bank transfer |
| Card `4000 0000 0000 0002` | Blocked by bank → suggests wallet / bank transfer |
| Wallet number ending `0000` | Wallet limit → suggests card / bank transfer |

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/parse` | `{text}` → pre-filled request fields |
| `POST` | `/api/requests` | Create a request `{payerName, amount, currency, description, splitCount, dueDate}` |
| `GET` | `/api/requests` | List requests + dashboard stats |
| `GET` | `/api/requests/:id` | Request details |
| `GET` | `/api/requests/:id/qr` | QR code (SVG) for the pay link |
| `GET` | `/api/requests/:id/installments?share=0` | Installment quotes |
| `POST` | `/api/requests/:id/pay` | `{shareIndex, method, details}` → `200` paid / `402` declined with `rescue` options |
| `POST` | `/api/requests/:id/remind` | Log a reminder `{channel: whatsapp\|sms\|email}` |

## Code map

- `src/parser.js`: natural language → request fields (Claude, or rules as a fallback)
- `src/processor.js`: simulated payment rails, card validation, installment quotes, rescue logic
- `src/requests.js`: request lifecycle: splitting, status, payments, reminders, events
- `src/money.js`: integer minor-unit money and exact splitting
- `src/store.js`: JSON-file persistence (to be replaced by Postgres)
- `public/`: merchant dashboard (`index.html`) and payer checkout (`pay.html`)
