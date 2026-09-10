"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { describeAuthError } from "@/lib/auth";
import {
  AuthLink,
  Field,
  FormError,
  FormNotice,
  SubmitButton,
} from "../_components/form";

const MIN_PASSWORD_LENGTH = 6;

export default function SignupForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password !== confirmPassword) {
      setError("The two passwords don't match.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the on_auth_user_created trigger to seed tbl_user_profiles.
        data: { display_name: displayName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding`,
      },
    });

    if (error) {
      setError(
        error.message.toLowerCase().includes("already registered")
          ? "That email is already registered."
          : describeAuthError(error)
      );
      setLoading(false);
      return;
    }

    // With confirmations on, Supabase returns a decoy user for an address that
    // already exists; the giveaway is an empty identities array.
    if (data.user && data.user.identities?.length === 0) {
      setError("That email is already registered.");
      setLoading(false);
      return;
    }

    if (data.session) {
      // Confirmations off — the user is signed in already.
      router.replace("/onboarding");
      router.refresh();
      return;
    }

    setAwaitingConfirmation(true);
    setLoading(false);
  }

  async function handleResend() {
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding`,
      },
    });

    if (error) setError(describeAuthError(error));
    else setNotice("Confirmation email sent.");
    setLoading(false);
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice>
          Check <span className="font-medium">{email}</span> for a confirmation
          link to finish setting up your account.
        </FormNotice>

        {error && <FormError>{error}</FormError>}
        {notice && <FormNotice>{notice}</FormNotice>}

        <button
          type="button"
          onClick={handleResend}
          disabled={loading}
          className="w-full bg-white border border-[rgba(0,0,0,0.1)] text-text-main rounded-xl py-3 text-sm font-medium hover:border-green-border transition-colors disabled:opacity-50"
        >
          {loading ? "Sending…" : "Resend confirmation email"}
        </button>

        <p className="text-center text-xs text-text-muted mt-2">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field
        label="Display name"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Alex"
        required
        maxLength={40}
        autoComplete="name"
      />

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
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />

      <Field
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="••••••••"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />

      {error && <FormError>{error}</FormError>}

      <SubmitButton loading={loading}>
        {loading ? "Creating account…" : "Create account"}
      </SubmitButton>

      <p className="text-center text-xs text-text-muted mt-2">
        Already have an account? <AuthLink href="/login">Sign in</AuthLink>
      </p>
    </form>
  );
}
