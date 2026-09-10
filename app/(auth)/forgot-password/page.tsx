import ForgotPasswordForm from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <>
      <p className="text-center text-sm text-text-muted mb-8">
        We&apos;ll email you a link to reset your password
      </p>
      <ForgotPasswordForm />
    </>
  );
}
