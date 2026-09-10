export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl text-text-main tracking-tight text-center mb-1">
          Zestil
        </h1>
        {children}
      </div>
    </div>
  );
}
