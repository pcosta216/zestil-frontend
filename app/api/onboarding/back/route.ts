import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadUserMemory, saveUserMemory } from "@/lib/onboarding/server-memory";
import { canGoBack, goBack, recalledAnswer, renderNode } from "@/lib/onboarding/engine";

// POST /api/onboarding/back — discards the node on screen (unanswered) and
// reverts the previous node's write, returning that node for re-answering.
// See engine.ts's goBack for why this is the whole mechanism — same-answer
// resubmission is a no-op by construction (the flow re-derives identically),
// a different answer naturally invalidates anything downstream the next
// time the person walks forward through it.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { memory, history } = await loadUserMemory(user.id);
    const result = goBack(memory, history);
    await saveUserMemory(user.id, result.memory, result.history);

    const rendered = await renderNode(result.target.nodeId, result.target.item, result.memory);
    // What was answered here before. The screen re-renders with it (selections still selected,
    // "Other" entries listed and removable) instead of blank — memory can't supply it, since
    // goBack just reverted this node's writes. See HistoryEntry.answer.
    return NextResponse.json({
      node: rendered.node,
      item: rendered.item,
      canGoBack: canGoBack(result.history),
      previousAnswer: recalledAnswer(result.history, result.target),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to go back";
    const isNothingToBackTo = message.includes("no previous node to go back to");
    if (!isNothingToBackTo) console.error("[onboarding/back]", err);
    return NextResponse.json({ error: message }, { status: isNothingToBackTo ? 400 : 500 });
  }
}
