import LoginForm from "./LoginForm";
import { authErrorMessage } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;

  return (
    <>
      <p className="text-center text-sm text-text-muted mb-8">
        Sign in to your meal planner
      </p>
      <LoginForm initialError={authErrorMessage(code)} />
    </>
  );
}
