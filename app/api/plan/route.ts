import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PLAN_FUNCTION_URL =
  process.env.PLAN_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/router-agent`;

export async function POST(req: NextRequest) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  console.log("[/api/plan] cookies present:", allCookies.map(c => c.name));

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  console.log("[/api/plan] user:", user?.id ?? null, "error:", error?.message ?? null);

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { data: { session } } = await supabase.auth.getSession();

  const body = await req.json().catch(() => ({}));

  let data: Response;
  try {
    data = await fetch(PLAN_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        ...body,
        user_id: user.id,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach plan agent" },
      { status: 502 }
    );
  }

  const result = await data.json();
  console.log("[/api/plan] upstream status:", data.status, "body:", JSON.stringify(result).slice(0, 200));

  if (!data.ok) {
    return NextResponse.json(result, { status: data.status });
  }

  return NextResponse.json(result);
}
