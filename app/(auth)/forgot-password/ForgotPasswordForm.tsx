"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { describeAuthError } from "@/lib/auth";
import {
  AuthLink,
  Field,
  FormError,
  FormNotice,
  SubmitButton,
} from "../_components/form";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });

    if (error) setError(describeAuthError(error));
    else setSent(true);
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {sent ? (
        // Deliberately neutral: this shouldn't reveal whether the address
        // belongs to an account.
        <FormNotice>
          If an account exists for <span className="font-medium">{email}</span>,
          a reset link is on its way.
        </FormNotice>
      ) : (
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      )}

      {error && <FormError>{error}</FormError>}

      {!sent && (
        <SubmitButton loading={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </SubmitButton>
      )}

      <p className="text-center text-xs text-text-muted mt-2">
        <AuthLink href="/login">Back to sign in</AuthLink>
      </p>
    </form>
  );
}
