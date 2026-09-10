import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Signed-out pages. A signed-in user hitting one is sent to the app. */
const GUEST_ROUTES = ["/login", "/signup", "/forgot-password"];

/**
 * Pages that need a session. `/reset-password` is here rather than in
 * GUEST_ROUTES on purpose: a recovery link signs the user in before they land
 * on it, so it has to stay reachable while authenticated.
 */
const PROTECTED_ROUTES = ["/onboarding", "/reset-password"];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (
    !user &&
    (pathname.startsWith("/zestil") || PROTECTED_ROUTES.includes(pathname))
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && GUEST_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/zestil", request.url));
  }

  return supabaseResponse;
}

export const config = {
  // /auth/confirm is deliberately absent — it sets the session cookies itself.
  matcher: [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/zestil/:path*",
    "/api/:path*",
  ],
};
