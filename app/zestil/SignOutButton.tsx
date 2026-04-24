"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-xs font-medium text-text-muted border border-[rgba(0,0,0,0.1)] bg-white px-3 py-1.5 rounded-full hover:border-green-border transition-colors"
    >
      Sign out
    </button>
  );
}
