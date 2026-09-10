import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : null;

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display text-3xl text-text-main tracking-tight mb-2">
          Welcome{displayName ? `, ${displayName}` : ""}
        </h1>
        <p className="text-sm text-text-muted mb-10">
          Your account is ready. The onboarding flow will live here.
        </p>

        {/* `replace` so Back doesn't drop the user into onboarding again. */}
        <Link
          replace
          href="/zestil"
          className="inline-block w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
