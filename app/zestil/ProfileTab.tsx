"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SignOutButton from "./SignOutButton";
import { BiometricsCard } from "./BiometricsCard";
import { ProfileSectionCard } from "./ProfileCard";
import { EditButton } from "./EditButton";
import { UserAvatar } from "@/components/UserAvatar";
import { DISPLAY_NAME_MAX, normalizeDisplayName, saveDisplayName, type ProfileBiometrics, type ProfileSection } from "@/lib/profile";
import type { UserProfile } from "@/lib/supabase/queries";

interface Props {
  profile: UserProfile | null;
  biometrics: ProfileBiometrics | null;
  /** The read-only cards; null when the memory couldn't be read (the biometrics card says so). */
  sections: ProfileSection[] | null;
  /** Auth email, used when the profile row carries none of its own. */
  fallbackEmail: string;
  userId: string;
}

export function ProfileTab({ profile, biometrics, sections, fallbackEmail, userId }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(profile?.display_name?.trim() || null);
  const [nameDraft, setNameDraft] = useState<string | null>(null); // null while not editing
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const email = profile?.email?.trim() || fallbackEmail;

  const startEditingName = () => {
    setNameDraft(displayName ?? "");
    setNameError(null);
  };

  async function saveName() {
    if (nameDraft === null) return;
    if (normalizeDisplayName(nameDraft) === displayName) {
      setNameDraft(null);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      setDisplayName(await saveDisplayName(nameDraft));
      setNameDraft(null);
      // The header's avatar reads the page's props, and a back navigation would bring the old name back.
      router.refresh();
    } catch {
      setNameError("Couldn't save your name. Try again.");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-5 py-5 flex flex-col">
        <h1 className="font-display text-lg text-text-main mb-8">Profile</h1>

        <div className="flex flex-col items-center text-center">
          <UserAvatar
            pictureUrl={profile?.picture_url ?? null}
            displayName={displayName}
            email={email}
            size={96}
            textClassName="text-2xl"
          />

          {nameDraft === null ? (
            <div className="flex items-center gap-1.5 mt-4">
              <p className={`font-display text-xl tracking-tight ${displayName ? "text-text-main" : "text-text-muted"}`}>
                {displayName ?? "No name set"}
              </p>
              <EditButton label="Edit name" onClick={startEditingName} />
            </div>
          ) : (
            <div className="w-full max-w-xs mt-4">
              <input
                autoFocus
                value={nameDraft}
                maxLength={DISPLAY_NAME_MAX}
                placeholder="Your name"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !savingName) saveName();
                  if (e.key === "Escape" && !savingName) setNameDraft(null);
                }}
                className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-xl px-4 py-2.5 text-sm text-center text-text-main outline-none focus:border-green-mid transition-colors"
              />
              {nameError && <p className="text-xs text-red-600 mt-1.5">{nameError}</p>}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setNameDraft(null)}
                  disabled={savingName}
                  className="flex-1 bg-white border border-[rgba(0,0,0,0.1)] text-text-main rounded-xl py-2 text-sm font-medium hover:border-green-border transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveName}
                  disabled={savingName}
                  className="flex-1 bg-green-primary text-white rounded-xl py-2 text-sm font-medium hover:bg-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}

          <p className="text-sm text-text-muted mt-1 break-all">{email}</p>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <BiometricsCard biometrics={biometrics} />
          {sections?.map((section) => <ProfileSectionCard key={section.title} section={section} />)}
        </div>

        <p className="mt-auto pt-8 text-left text-xs text-text-muted font-mono break-all select-all">
          {userId}
        </p>
      </div>

      <div className="px-4 sm:px-5 py-4 bg-white border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
        <SignOutButton />
      </div>
    </div>
  );
}
