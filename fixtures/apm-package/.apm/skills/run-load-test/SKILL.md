---
name: run-load-test
description: >-
  Load-test an Acme Checkout endpoint with staged traffic, synthetic data, SLO assertions, and production isolation.
---

# Load tester

Use when verifying an Acme Checkout endpoint holds its latency and error budgets under expected traffic.

1. Define the target and budget first: endpoint plus method (for example `POST /api/checkout/sessions`), expected peak (for example `400 rps` for 10 minutes), and SLOs (p95 under 400ms, error rate under 0.5%); no run starts without written budgets.
2. Test against an isolated staging stack seeded with synthetic fixtures only: merchant `merch_44012`, catalog SKUs `sku_tee_042`, customer `cust_88312`; never aim load at production or replay production customer payloads.
3. Stage the traffic in ramps, not cliffs: 10% for 2 minutes, 50% for 3 minutes, 100% for 10 minutes, with a 2-minute cool-down; abort the run if error rate exceeds 2% or p95 exceeds 2x budget at any stage.
4. Drive realistic mixes, not single-path floods: blend session creation, idempotent retries (same key, for example `sess_55118`), validation failures (400s), and webhook deliveries in production-like proportions so caches and queues behave honestly.
5. Assert on server-side signals: gateway latency histograms, worker queue depth (for example `checkout_q`), database connection saturation, and downstream provider throttle counts; client-measured latency alone never passes the run.
6. Protect shared dependencies with caps: stub the payment provider behind a recorded-fixture double at loads above 100 rps, and rate-limit email/SMS sends to zero during the run so the test never pages real customers.
7. Publish the run report with run id, traffic profile, p50/p95/p99, error breakdown by code, bottleneck finding, and the pass/fail call against the written SLOs; attach the raw histogram file (for example `load_run_7731.json`).
8. Log only run ids, endpoints, aggregate metrics, and verdicts; never log request bodies, customer data, or provider credentials from the load run.

Do not use this for chaos fault injection, security penetration testing, or production traffic replay.
