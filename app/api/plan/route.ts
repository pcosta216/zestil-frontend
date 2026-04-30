import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PLAN_FUNCTION_URL =
  process.env.PLAN_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/plan-agent`;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  let data: Response;
  try {
    data = await fetch(PLAN_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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

  if (!data.ok) {
    return NextResponse.json(result, { status: data.status });
  }

  return NextResponse.json(result);
}
