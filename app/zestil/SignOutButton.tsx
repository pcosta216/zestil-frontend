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
      className="w-full bg-white text-sm font-medium text-text-main border border-[rgba(0,0,0,0.1)] rounded-xl py-3 hover:border-green-border transition-colors"
    >
      Sign out
    </button>
  );
}
