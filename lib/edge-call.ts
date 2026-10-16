import { createClient } from "@/lib/supabase/browser";
import { isAllowedCall, parseUiBody, substituteValue, type UiBody, type UiCallAction } from "@/lib/ui-body";
import { EDGE_REGION_QUERY } from "@/lib/edge-region";

export type EdgeReply = {
  ok?: boolean;
  message?: string;
  // The reply's own blocks, or the one sentence the endpoint sent as a text block when it sent none (§4.3).
  // Undefined when the reply had neither.
  uiBody?: UiBody;
  // The reply's ui_body exactly as the agent sent it, parsed: undefined when it had none. A switch needs
  // to tell the two apart (§3.1.4).
  sentBody?: UiBody;
};

// The one place a `call` action goes out (contract §4.1): a POST to {SUPABASE_URL}/functions/v1/{endpoint}
// with the signed-in user's JWT, from the browser, with no model and no chat turn. Only allowlisted
// endpoints are ever called. Throws on a missing session, a non-2xx, or a network error, and the callers
// show their own inline error for it. `value` replaces an exact "{value}" in the body (§4.2).
export async function callEdge(action: UiCallAction, value?: string | boolean): Promise<EdgeReply> {
  if (!isAllowedCall(action)) throw new Error("endpoint not allowed");
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("no session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${action.endpoint}?${EDGE_REGION_QUERY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(value === undefined ? action.body : substituteValue(action.body, value)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const message = typeof data.message === "string" && data.message ? data.message : undefined;
  const sentBody = parseUiBody(data.ui_body);
  return {
    ok: data.ok,
    message,
    sentBody,
    uiBody: sentBody ?? (message ? { version: 1, blocks: [{ type: "text", caption: message }] } : undefined),
  };
}
