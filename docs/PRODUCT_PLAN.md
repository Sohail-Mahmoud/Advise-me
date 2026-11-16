# FlowPay: Product Plan

> Working name. Check the trademark before any public launch.

## 1. One-line pitch

**FlowPay turns "you owe me money" into "you've been paid" in one message.** A business types or says what it wants to charge. FlowPay sends a single link (or QR code) that the customer pays in one tap, with the method they prefer. The bill can be split between several people or paid in installments. If a payment fails, FlowPay rescues it on the spot by offering another method.

## 2. The problem

Collecting a payment still has too much friction, mainly for small and mid-sized businesses (freelancers, clinics, tutors, landlords, small B2B suppliers):

| Pain | Today |
|---|---|
| Creating a bill is slow | Fill in invoice forms, copy bank details into WhatsApp, chase people manually |
| The payer's preferred method isn't offered | Merchant takes cards only, customer wants a wallet or a bank transfer (or the reverse) |
| Failed payments become lost sales | A declined card shows an error and the customer leaves |
| Group or shared bills are awkward | One person pays and chases the others, or the merchant handles many partial transfers |
| Big tickets stall | The customer can't pay the full amount now and there's no installment option |
| No visibility | The merchant can't see who has paid, what's partial and what's overdue |

## 3. Target customers

The **fintech company sells FlowPay** to:

1. **SMBs and freelancers** (primary, self-serve): monthly SaaS fee plus a per-transaction fee.
2. **Banks and wallets** (secondary, white-label): embed FlowPay "smart requests" in their merchant app.
3. **Platforms and marketplaces** (later): API and webhooks to create requests from their own systems.

**User roles**
- **Merchant**: creates requests and tracks money in.
- **Payer**: opens a link and pays; never needs an account.
- **Admin / ops** (the fintech's own staff): risk, disputes, settlement (later phase).

## 4. Core product ideas (what makes it "easier and smoother")

1. **Natural-language billing.** The merchant writes *"Bill Sara 1,200 EGP for website design, split between 3, due Dec 1"* and FlowPay fills in the request. Claude does the parsing, and a rule-based parser keeps it working offline.
2. **One link, every rail.** The same link accepts card, mobile wallet, instant bank transfer and installments. The payer chooses; the merchant configures nothing.
3. **Smart payment rescue.** When a payment is declined (for example, insufficient funds or a card limit), the checkout immediately suggests the best alternative: installments for insufficient funds, wallet or bank transfer for a card block. The payer never sees a dead-end error.
4. **Built-in split.** One request becomes N shares. Each payer pays their share from the same link, and the merchant sees a progress bar.
5. **Installments at checkout.** 3 or 6 monthly payments with a transparent fee, decided at the moment of payment.
6. **Live status and reminders.** Each request shows pending / partially paid / paid / overdue, with one-click reminders and an event timeline (the basis for webhooks).

## 5. MVP scope (built in this repo: `flowpay/`)

| Feature | In MVP | Notes |
|---|---|---|
| Merchant dashboard: create, list and track requests | ✅ | |
| Natural-language request creation (Claude, with rule-based fallback) | ✅ | Works without an API key |
| Shareable pay link + QR code | ✅ | |
| Checkout: card / wallet / bank transfer / installments | ✅ | **Simulated** payment rails; no real money moves |
| Card validation (Luhn, expiry, CVC) | ✅ | |
| Smart rescue on decline | ✅ | Test cards trigger the declines |
| Bill splitting into N shares | ✅ | Integer minor units, so no rounding loss |
| Reminders and event timeline | ✅ | Reminders are logged, not actually sent |
| Real PSP integration, KYC, settlement, refunds, auth | ❌ | Phase 2 |

## 6. Architecture

```
Browser (merchant dashboard, payer checkout)
        │  JSON over HTTP
        ▼
Express API (Node 22)
  ├── parser      NL text → request fields (Claude structured output, or regex fallback)
  ├── requests    create / split / status / reminders / events
  ├── processor   payment-rail adapters (simulated) + rescue suggestions
  └── store       JSON-file persistence (swap for Postgres in Phase 2)
```

**Phase 2 target architecture:** Postgres; a payment-provider abstraction (card acquirer, wallet APIs, instant-transfer rails such as InstaPay / Open Banking / UPI depending on market); a webhook dispatcher with retries; merchant auth (OIDC); a PCI-DSS scope reduction by using provider-hosted card fields (tokenization), so card data never touches FlowPay servers.

## 7. Business model

- **Per transaction:** about 1.5–2.5% for cards and installments, a flat low fee for wallet and bank transfer.
- **Subscription:** Free (limited requests per month) → Pro (unlimited, branding, reminders automation) → Business (API, webhooks, team seats).
- **Installment revenue share** with the lending partner.
- **White-label licence** for banks and wallets.

## 8. Success metrics

- **Time to create a request:** under 15 seconds (median).
- **Checkout conversion:** link opened → paid, above 70%.
- **Rescue rate:** declined attempts later paid via the suggested method, above 30%.
- **Days sales outstanding** for merchants, down 40% compared with their baseline.

## 9. Risks and compliance

- **Regulation.** Payments and lending licensing differ by market, so launch through a licensed partner (payment facilitator model) and keep installments with a regulated lender.
- **PCI-DSS.** Never store raw card data; use tokenized, provider-hosted fields in production.
- **Fraud and AML.** Velocity limits, link expiry, transaction monitoring, and sanctions screening on merchants (KYB).
- **AI parsing errors.** The AI only *pre-fills* the form, and the merchant always confirms before a request is created.
- **Data protection.** Payer data minimisation, plus regional data residency where required.

## 10. Roadmap

| Phase | Timeline | Deliverables |
|---|---|---|
| 0: MVP (this repo) | Done | Simulated end-to-end flow, for demos and user testing |
| 1: Pilot | +2–3 months | One real PSP, merchant sign-up + KYB, Postgres, real SMS/WhatsApp/email reminders, 20 pilot merchants |
| 2: Launch | +3 months | Installments partner, webhooks + public API, refunds/disputes, analytics |
| 3: Scale | +6 months | White-label SDK for banks, recurring requests, multi-currency, voice-note billing |
