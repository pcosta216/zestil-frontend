import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage() {
  // Following a recovery link signs the user in, so no session here means the
  // link was never opened, expired, or was already used.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?error=expired_link");

  return (
    <>
      <p className="text-center text-sm text-text-muted mb-8">
        Choose a new password
      </p>
      <ResetPasswordForm />
    </>
  );
}
