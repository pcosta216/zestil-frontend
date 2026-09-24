import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNodeStructure } from "@/lib/onboarding/flow-structure";
import { loadUserMemory } from "@/lib/onboarding/server-memory";
import { validateEntries } from "@/lib/onboarding/validate-other";

interface ValidateOtherBody {
  node_id?: string;
  item?: string;
  entries?: string[];
}

// POST /api/onboarding/validate-other — validates the comma-split pieces of
// an other_capture free-text entry BEFORE they're submitted as an answer.
// Unlike the generic app/api/onboarding/validate/route.ts (a raw pass-through
// for an already-built payload), this route does the interpolation itself —
// other_capture.validation.payload.context can reference memory paths (e.g.
// n_intolerances' "{dietary.allergies}", n_dishes' "{item}" + diet_type) that
// only the server has, not the client rendering the node.
//
// Called by MultiSelect.tsx before handleAnswer, not as part of
// /api/onboarding/answer itself — keeps engine.ts (and that route's
// contract) untouched; this is purely a pre-submit check.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as ValidateOtherBody;
  if (!body.node_id || !body.entries || body.entries.length === 0) {
    return NextResponse.json({ error: "node_id and entries are required" }, { status: 400 });
  }

  const structure = getNodeStructure(body.node_id);
  const validation = structure.other_capture?.validation ?? structure.validation;
  if (!validation) {
    // Nothing to validate against — treat every entry as valid rather than erroring, so a
    // misconfigured node never blocks the user from submitting their free text.
    return NextResponse.json({
      results: body.entries.map((entry) => ({ entry, verdict: "valid", value: null, label: null, reason: null })),
    });
  }

  // The Onboarding Validator Agent is a Supabase Edge Function gated by verify_jwt — needs the
  // caller's own session bearer token, same pattern as app/api/chat/route.ts and
  // app/api/plan/optimise/route.ts (never a service-role key for this call).
  const { data: { session } } = await supabase.auth.getSession();

  const { memory } = await loadUserMemory(user.id);
  const results = await validateEntries(body.entries, validation, { item: body.item, memory }, user.id, session?.access_token);
  return NextResponse.json({ results });
}
