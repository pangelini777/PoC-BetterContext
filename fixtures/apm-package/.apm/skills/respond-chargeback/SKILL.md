---
name: respond-chargeback
description: >-
  Respond to an Acme Checkout chargeback with evidence assembly, deadline tracking, representment packaging, and loss recording.
---

# Chargeback responder

Use when handling a payment dispute or chargeback notification for an Acme Checkout order.

1. Triage the dispute notice first: record dispute id (for example `dp_61208`), order id (for example `ord_77120`), disputed amount, reason code (`fraudulent`, `product_not_received`, `duplicate`), and the provider deadline; never miss the deadline — calendar it with a 48-hour internal buffer.
2. Freeze the linked order record: preserve the charge, capture, fulfillment, and refund history as evidence; block further refunds on the disputed payment until the dispute closes, returning 409 on conflicting refund attempts.
3. Assemble the evidence pack from trusted sources only: signed order receipt, capture timestamp, tracking number with delivery scan (for example carrier `acme-post`, tracking `AP88203110`), customer communication excerpts, and refund/void history; pull each item by id, never from user-supplied attachments alone.
4. Match the response to the reason code: for `fraudulent` include AVS/CVC results and login-device evidence, for `product_not_received` include delivery proof, for `duplicate` include both charge ids and the single-fulfillment record; omit irrelevant exhibits.
5. Submit representment exactly once through the provider API with an idempotency key derived from the dispute id (for example `dispute-dp_61208-represent`); on retry, reuse the key so a second submission overwrites nothing and creates no duplicate case.
6. Record the outcome as a terminal ledger entry: `dispute.won` or `dispute.lost` with dispute id, amount, fee, and decision date; on loss, write off the amount plus fee and close the linked order note without reopening fulfillment.
7. Notify the merchant (for example `merch_44012`) with a templated summary carrying only dispute id, order id, amount, and outcome; never include full card numbers, customer addresses, or provider raw payloads.
8. Log only dispute id, order id, amount, reason code, and outcome; never log card data, customer PII, or full provider dispute bodies in application logs.

Do not use this to issue goodwill refunds, change fraud rules, or retry the original charge.
