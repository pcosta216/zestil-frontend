import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const OPTIMISE_FUNCTION_URL =
  process.env.OPTIMISE_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/optimize-day-agent`;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "No session token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const res = await fetch(OPTIMISE_FUNCTION_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ...body, user_id: user.id }),
  });

  const data = await res.json().catch(() => ({ error: "Invalid response from optimiser" }));
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
