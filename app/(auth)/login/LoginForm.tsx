"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import {
  AuthLink,
  Field,
  FormError,
  FormNotice,
  SubmitButton,
} from "../_components/form";

export default function LoginForm({
  initialError,
}: {
  initialError?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Only reachable once email confirmation is switched on.
      if (error.message.toLowerCase().includes("not confirmed")) {
        setUnconfirmed(true);
        setError("Confirm your email address before signing in.");
      } else {
        setError(error.message);
      }
      setLoading(false);
    } else {
      router.replace("/zestil");
      router.refresh();
    }
  }

  async function handleResend() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });

    if (error) setError(error.message);
    else setNotice("Confirmation email sent — check your inbox.");
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
      />

      <Field
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        required
        autoComplete="current-password"
      />

      {error && <FormError>{error}</FormError>}
      {notice && <FormNotice>{notice}</FormNotice>}

      {unconfirmed && (
        <button
          type="button"
          onClick={handleResend}
          disabled={loading}
          className="text-xs text-green-primary hover:text-green-dark transition-colors self-start disabled:opacity-50"
        >
          Resend confirmation email
        </button>
      )}

      <SubmitButton loading={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </SubmitButton>

      <div className="flex flex-col gap-2 text-center text-xs text-text-muted mt-2">
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
        <p>
          Don&apos;t have an account? <AuthLink href="/signup">Sign up</AuthLink>
        </p>
      </div>
    </form>
  );
}
