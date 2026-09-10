/** Email OTP types we accept from a confirmation link. */
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

export type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

export function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Only allow same-origin, single-slash paths through as a redirect target so a
 * crafted `next=` on a confirmation link can't bounce the user off-site.
 */
export function safeRedirect(next: string | null, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

/**
 * Fixed copy for the `?error=` codes /auth/confirm can hand back, so nothing
 * from the URL is rendered verbatim.
 */
const AUTH_ERRORS: Record<string, string> = {
  expired_link:
    "That link has expired or was already used. Request a new one below.",
  invalid_link: "That link is not valid. Request a new one below.",
  verify_failed:
    "We couldn't verify that link. It may have expired — request a new one below.",
};

export function authErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return AUTH_ERRORS[code] ?? AUTH_ERRORS.invalid_link;
}

/**
 * Auth errors are shown to the user as-is, except rate limiting: the built-in
 * Supabase mailer only allows a handful of messages per hour, and the raw
 * message alone doesn't explain why.
 */
export function describeAuthError(error: {
  status?: number;
  message: string;
}): string {
  if (error.status === 429) {
    return `Email rate limit reached — the built-in mailer only allows a few messages per hour. ${error.message}`;
  }
  return error.message;
}
