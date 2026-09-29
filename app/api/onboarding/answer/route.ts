import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadUserMemory, saveUserMemory } from "@/lib/onboarding/server-memory";
import { applyAnswer, canGoBack, recalledAnswer, renderNode } from "@/lib/onboarding/engine";
import type { Answer } from "@/lib/onboarding/types";

interface AnswerBody {
  node_id?: string;
  item?: string;
  answer?: Answer;
}

// POST /api/onboarding/answer — records one answer (meta.autosave_after_each_node:
// every call is a real, immediate write to tbl_user_memory, not batched) and
// returns the next node to render.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as AnswerBody;
  if (!body.node_id || !body.answer) {
    return NextResponse.json({ error: "node_id and answer are required" }, { status: 400 });
  }

  try {
    const { memory, history } = await loadUserMemory(user.id);

    // Reject an answer for a node that isn't the one currently open — a stale client (e.g. a
    // second tab, or a slow retry after the flow already advanced) shouldn't silently mis-write.
    const openEntry = history.find((h) => h.exited_at === null);
    if (openEntry && (openEntry.node_id !== body.node_id || openEntry.repeat_key !== body.item)) {
      const current = await renderNode(openEntry.node_id, openEntry.repeat_key, memory);
      return NextResponse.json(
        {
          error: "Stale node — the flow has moved on",
          node: current.node,
          item: current.item,
          canGoBack: canGoBack(history),
          previousAnswer: recalledAnswer(history, { nodeId: openEntry.node_id, item: openEntry.repeat_key }),
        },
        { status: 409 }
      );
    }

    const result = await applyAnswer({ nodeId: body.node_id, item: body.item, answer: body.answer, memory, history });
    await saveUserMemory(user.id, result.memory, result.history);

    if ("terminal" in result.next) return NextResponse.json({ done: true });

    const rendered = await renderNode(result.next.nodeId, result.next.item, result.memory);
    // Normally undefined — a forward move lands on a node being seen for the first time. Set
    // only when the answer was a confirm_edit "something's wrong", which rewinds INTO an
    // already-answered node (n_allergy_confirm -> n_allergies) rather than moving forward.
    return NextResponse.json({
      node: rendered.node,
      item: rendered.item,
      canGoBack: canGoBack(result.history),
      previousAnswer: recalledAnswer(result.history, result.next),
    });
  } catch (err) {
    console.error("[onboarding/answer]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to record answer" }, { status: 500 });
  }
}
