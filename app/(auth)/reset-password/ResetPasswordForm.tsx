"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Field, FormError, SubmitButton } from "../_components/form";

const MIN_PASSWORD_LENGTH = 6;

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Whoever opened the recovery link keeps this session; every other session
    // for the account is revoked.
    await supabase.auth.signOut({ scope: "others" });

    router.replace("/zestil");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />

      <Field
        label="Confirm new password"
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
        {loading ? "Updating…" : "Update password"}
      </SubmitButton>
    </form>
  );
}
