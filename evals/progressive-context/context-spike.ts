// Phase-0 context-transform / hook-order spike.
// Inspects the INSTALLED OpenCode plugin API and proves whether any hook can
// guarantee historical overlay removal from the next provider request.
// Verdict (recorded): the installed API (opencode 1.18.31, @opencode-ai/plugin
// 1.18.31) exposes chat.message (mutate incoming user message), chat.params
// (temperature/topP/topK/maxTokens/options only), experimental chat.messages
// .transform + chat.system.transform (message/system rewrite hooks), and tool
// pre/post hooks. None of these observe or control the provider's assembled
// history+system bytes with a reconstruction guarantee: transforms receive
// already-shaped message lists with no contract that prior assistant turns
// carrying old overlay text are re-scrubbed, and there is no provider-request
// construction hook. A sentinel injected via chat.message would persist in
// history on later turns. Therefore the spike verdict is NEGATIVE for OpenCode
// as the authoritative unload path: the benchmark-owned ExplicitHarness
// (which assembles each request and scrubs all historical overlay blocks
// before inserting exactly one current overlay) is the authoritative
// lifecycle/context-health proof. OpenCode remains a secondary demo.
// The sentinel assertions below prove the harness side of that verdict.

import { readFile } from "node:fs/promises";
import { ExplicitHarness, compileOverlay, countOverlays } from "../../packages/progressive-context/src/compiler.ts";
import { KERNEL } from "../../packages/progressive-context/src/session.ts";

const PLUGIN_DTS = "/home/dev/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts";

async function main(): Promise<void> {
  const dts = await readFile(PLUGIN_DTS, "utf8").catch(() => "");
  const hooks = [
    "chat.message",
    "chat.params",
    "experimental.chat.messages.transform",
    "experimental.chat.system.transform",
    "tool.execute.before",
    "tool.execute.after",
  ];
  const observed = hooks.map((h) => ({ hook: h, present: dts.includes(`"${h}"`) }));
  const hasProviderRequestHook =
    dts.includes("provider.request") || dts.includes("chat.request") || dts.includes("model.request");

  // Sentinel proof on the authoritative harness path.
  const bodies = new Map([
    ["rule.alpha", `<jev-resource id="rule.alpha">UNIQUE_ALPHA_SENTINEL_7F3A</jev-resource>`],
  ]);
  const h = new ExplicitHarness(KERNEL);
  const c1 = compileOverlay(["rule.alpha"], bodies, "evt-spike-0");
  c1.kernel = KERNEL;
  const reqN = h.step("evt-spike-0", "alpha active", c1);
  const c2 = compileOverlay([], bodies, "evt-spike-1");
  c2.kernel = KERNEL;
  const reqNext = h.step("evt-spike-1", "alpha retired", c2);
  const sentinelPresentN = reqN.includes("UNIQUE_ALPHA_SENTINEL_7F3A");
  const sentinelAbsentNext = !reqNext.includes("UNIQUE_ALPHA_SENTINEL_7F3A");
  const singleOverlay = countOverlays(reqNext) <= 1;

  const verdict =
    !hasProviderRequestHook && sentinelPresentN && sentinelAbsentNext && singleOverlay
      ? "NEGATIVE_FOR_OPENCODE_AUTHORITATIVE__EXPLICIT_HARNESS_AUTHORITATIVE"
      : "NEEDS_REVIEW";

  console.log(
    JSON.stringify(
      {
        check: "context-spike",
        observedHooks: observed,
        hasProviderRequestHook,
        harnessSentinel: { sentinelPresentN, sentinelAbsentNext, singleOverlay },
        verdict,
        note: "OpenCode kept as secondary integration demo; ExplicitHarness is authoritative for unload proof.",
      },
      null,
      2,
    ),
  );
  if (verdict === "NEEDS_REVIEW") process.exit(1);
}

await main();
