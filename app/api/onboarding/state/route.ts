import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadUserMemory, saveUserMemory } from "@/lib/onboarding/server-memory";
import { canGoBack, recalledAnswer, renderNode, resolveResumeTarget } from "@/lib/onboarding/engine";

// GET /api/onboarding/state — the node to render right now. Always goes
// through resolveResumeTarget: the currently open entry in the normal
// case, the flow's entry point for a genuinely brand-new session, or a
// precise recovery via the last entry's `resolved_next` if history exists
// but nothing is open (an anomaly — previously this fell back to
// restarting the whole flow from n_welcome, which is exactly the "stuck
// repeating the same screen" bug this replaced). Any of these paths can
// write to memory/history (auto-skips, or reopening a recovered entry),
// so always save afterward rather than only on the "fresh session" branch.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { memory, history } = await loadUserMemory(user.id);

    const target = await resolveResumeTarget(memory, history);
    await saveUserMemory(user.id, memory, history);

    if ("terminal" in target) return NextResponse.json({ done: true });

    const rendered = await renderNode(target.nodeId, target.item, memory);
    // Set only when the open entry is one the user backed into — reloading the page right after
    // Back keeps their choices on screen instead of dropping them. Undefined on a normal resume.
    return NextResponse.json({
      node: rendered.node,
      item: rendered.item,
      canGoBack: canGoBack(history),
      previousAnswer: recalledAnswer(history, target),
    });
  } catch (err) {
    console.error("[onboarding/state]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load onboarding state" }, { status: 500 });
  }
}
