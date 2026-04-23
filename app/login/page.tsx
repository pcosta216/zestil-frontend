import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl text-text-main tracking-tight mb-1">
            Zestil
          </h1>
          <p className="text-sm text-text-muted">
            Sign in to your meal planner
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
