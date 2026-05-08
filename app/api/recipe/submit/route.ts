import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AGENT_API_URL = process.env.AGENT_API_URL;
const AGENT_API_KEY = process.env.AGENT_API_KEY;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  console.log("[recipe/submit] url:", `${AGENT_API_URL}/api/v1/recipe/submit`);
  try {
    const res = await fetch(`${AGENT_API_URL}/api/v1/recipe/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    AGENT_API_KEY!,
        "X-User-Id":    user.id,
      },
      body: JSON.stringify(body),
    });
    console.log("[recipe/submit] backend status:", res.status);
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err) {
    console.error("[recipe/submit] fetch error:", err);
    return NextResponse.json({ error: "Could not reach recipe agent" }, { status: 502 });
  }
}
