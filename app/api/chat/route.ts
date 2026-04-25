import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FLASK_API_URL = process.env.FLASK_API_URL ?? "http://localhost:5001";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${FLASK_API_URL}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": user.id,
      },
      body,
    });
  } catch {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "Could not reach agent backend" })}\n\n`,
      { status: 502, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: text || "Agent error" })}\n\n`,
      { status: upstream.status, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
