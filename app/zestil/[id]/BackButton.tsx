"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="text-sm text-text-muted flex items-center gap-1 hover:text-text-main transition-colors"
    >
      ← Back
    </button>
  );
}
