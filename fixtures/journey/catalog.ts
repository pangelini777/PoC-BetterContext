// Server-side fixture catalog. Refund totals MUST be derived from this,
// never from client-supplied amounts.
export const CATALOG_ITEM = {
  id: "sku_refund_1",
  unitPriceCents: 4200,
  currency: "CHF",
} as const;
