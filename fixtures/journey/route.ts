export async function POST() {
  // TODO benchmark: implement POST /api/refunds with Idempotency-Key handling
  // (scoped replay 200 + Idempotent-Replayed vs 422 on key reuse) and trusted
  // server-side totals from ./catalog.ts (never client totals).
  return Response.json({ error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } }, { status: 501 });
}
