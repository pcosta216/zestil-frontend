"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.replace("/recipes");
      router.refresh();
    }
  }

  const inputCls =
    "w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors placeholder:text-text-muted";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          placeholder="••••••••"
          required
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 mt-1"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
