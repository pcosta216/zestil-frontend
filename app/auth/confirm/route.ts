import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailOtpType, safeRedirect } from "@/lib/auth";

/**
 * Landing point for every emailed auth link (confirm signup, password
 * recovery). Handles both link shapes:
 *   - `token_hash` + `type`, from the PKCE-style email templates
 *   - `code`, from Supabase's stock templates
 * On success the session cookies are set here and the user is sent to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeRedirect(searchParams.get("next"), "/zestil");

  // Supabase itself can report a failure before we ever see a token.
  const linkError = searchParams.get("error");
  if (linkError) {
    const code = searchParams.get("error_code");
    return redirectToLogin(
      request,
      code === "otp_expired" ? "expired_link" : "invalid_link"
    );
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createClient();

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    return redirectToLogin(request, "verify_failed");
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    return redirectToLogin(request, "verify_failed");
  }

  return redirectToLogin(request, "invalid_link");
}

function redirectToLogin(request: NextRequest, error: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}
