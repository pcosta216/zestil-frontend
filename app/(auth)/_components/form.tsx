"use client";

import { useId } from "react";
import Link from "next/link";

const inputCls =
  "w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-green-mid transition-colors placeholder:text-text-muted";

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5"
      >
        {label}
      </label>
      <input id={id} className={inputCls} {...props} />
    </div>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-text-main bg-green-light border border-green-border rounded-xl px-4 py-2.5">
      {children}
    </p>
  );
}

export function SubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-green-primary text-white rounded-xl py-3 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 mt-1"
    >
      {children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-green-primary hover:text-green-dark transition-colors">
      {children}
    </Link>
  );
}
