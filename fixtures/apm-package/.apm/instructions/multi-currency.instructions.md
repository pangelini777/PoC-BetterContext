---
description: "Multi-currency rules for Acme Checkout: minor-unit amounts, explicit currency codes, trusted FX rates, settlement currency, and locale-aware display."
applyTo: "app/api/checkout/**/*.ts,pricing/**/*.ts,currency/**/*.ts,orders/**/*.ts"
tags: [currency, pricing, checkout]
---

# Multi-currency handling

Apply when prices, totals, refunds, or invoices involve more than one currency or a currency conversion.

- Represent every amount as an integer in minor units paired with an explicit ISO currency code (for example `{ amountMinor: 1999, currency: "EUR" }`); never use floating-point types for money, and never carry an amount without its currency.
- Refuse to add, compare, or subtract amounts with different currency codes; convert first through a single documented conversion helper, then operate.
- Source FX rates from one trusted provider or table with a recorded timestamp and version; never accept a client-supplied rate, and never hard-code a rate inside checkout logic.
- Record the rate, rate version, source currency, and target currency on the order so finance can reaudit any converted total after the fact.
- Treat the settlement (charge) currency as authoritative: the amount actually charged by the payment provider wins, and every displayed estimate must label itself as an estimate until settlement.
- Expire stale quotes explicitly: a converted price shown to the shopper (for example an Acme Checkout cart estimated in JPY) must carry a quote timestamp, and checkout must reprice when the quote exceeds its documented lifetime.
- Compute refunds and partial credits from the stored settlement record, not from a fresh conversion at refund time; currency movement between purchase and refund must never change what the customer gets back without an explicit, reviewed policy.
- Keep raw FX provider payloads out of logs and error responses; log the rate identifier, version, and timestamp only, so provider internals cannot leak through diagnostics.
- Format displayed amounts with locale-aware rendering (correct symbol placement, grouping, and fraction digits per currency, including zero-decimal currencies); tests must assert the formatted string, not just the numeric value.
- Cover conversions with synthetic fixtures only (for example `EUR 42.00` at fixture rate `1 EUR = 162.10 JPY`): a standard conversion, a zero-decimal target, a same-currency no-op, a refund-from-settlement case, and a stale-quote repricing case.

Do not assume two amounts are comparable because their numeric values look similar; without matching currency codes the comparison is meaningless.
