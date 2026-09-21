export async function POST() {
  // TODO benchmark: create provider-hosted checkout session on the server.
  return Response.json({ error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } }, { status: 501 });
}
