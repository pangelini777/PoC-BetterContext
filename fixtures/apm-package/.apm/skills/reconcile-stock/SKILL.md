---
name: reconcile-stock
description: >-
  Reconcile Acme Checkout inventory counts across reservation, warehouse, and ledger stores with bounded recounts and oversell guards.
---

# Stock reconciler

Use when on-hand counts, reservation holds, or warehouse figures disagree for an Acme Checkout SKU.

1. Scope the recount to one SKU and one location at a time (for example SKU `sku_tee_042`, warehouse `wh_east_03`); reject unbounded full-catalog recounts and run them as paginated per-SKU jobs instead.
2. Snapshot the three figures independently: available-to-promise from the reservation service, physical count from the warehouse feed (for example `wms_snapshot_9918`), and the ledger balance from `inventory_ledger`; record each source id and timestamp before comparing.
3. Compute the expected balance as `ledger_in - ledger_out - active_holds` where active holds are unexpired rows in `reservation_holds` for the SKU; treat expired holds (TTL 15 minutes) as released, never as committed stock.
4. Classify the variance before fixing: small drift (±2 units) auto-corrects with a compensating ledger entry, large drift (±10 or more) opens an investigation ticket and freezes manual adjustment, and negative available-to-promise blocks new holds with 409 until resolved.
5. Apply corrections as append-only ledger entries (`recount.adjust` with SKU, delta, reason, operator), never by overwriting the count column; each entry references the snapshot ids so the correction replays deterministically.
6. Guard against oversell during reconciliation: hold-before-charge stays enforced, and any order authorized while counts were uncertain gets re-validated against the corrected figure before capture; void authorizations that no longer have stock.
7. Emit one `inventory.reconciled` event per SKU carrying SKU, location, delta, and snapshot ids; downstream search and storefront caches invalidate on this event rather than on raw count writes.
8. Log only SKU, location, deltas, and snapshot ids; never log customer order contents, supplier pricing, or warehouse credentials.

Do not use this for demand forecasting, purchase ordering, or price adjustments.
