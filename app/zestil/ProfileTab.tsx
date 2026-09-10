"use client";

import SignOutButton from "./SignOutButton";
import { UserAvatar } from "@/components/UserAvatar";
import type { UserProfile } from "@/lib/supabase/queries";

interface Props {
  profile: UserProfile | null;
  /** Auth email, used when the profile row carries none of its own. */
  fallbackEmail: string;
}

export function ProfileTab({ profile, fallbackEmail }: Props) {
  const displayName = profile?.display_name?.trim() || null;
  const email = profile?.email?.trim() || fallbackEmail;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5">
        <h1 className="font-display text-lg text-text-main mb-8">Profile</h1>

        <div className="flex flex-col items-center text-center">
          <UserAvatar
            pictureUrl={profile?.picture_url ?? null}
            displayName={displayName}
            email={email}
            size={96}
            textClassName="text-2xl"
          />

          {displayName ? (
            <p className="font-display text-xl text-text-main tracking-tight mt-4">
              {displayName}
            </p>
          ) : (
            <p className="font-display text-xl text-text-muted tracking-tight mt-4">
              No name set
            </p>
          )}

          <p className="text-sm text-text-muted mt-1 break-all">{email}</p>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-4 bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <SignOutButton />
      </div>
    </div>
  );
}
