"use client";

import { useState } from "react";
import Image from "next/image";

interface Props {
  /** Resolved `picture_id`, or null when the profile has no picture. */
  pictureUrl: string | null;
  displayName: string | null;
  email: string;
  /** Rendered width and height, in px. */
  size: number;
  /** Text size for the initials shown in place of a missing picture. */
  textClassName?: string;
}

export function UserAvatar({
  pictureUrl,
  displayName,
  email,
  size,
  textClassName = "text-[12px]",
}: Props) {
  // Cleared on a load error so a dead URL falls through to the initials.
  const [src, setSrc] = useState(pictureUrl);

  return (
    <div
      className="rounded-full overflow-hidden bg-green-mid flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          alt={displayName ? `${displayName}'s picture` : "Profile picture"}
          width={size}
          height={size}
          className="w-full h-full object-cover"
          unoptimized
          onError={() => setSrc(null)}
        />
      ) : (
        <span className={`${textClassName} font-medium text-green-dark`}>
          {initials(displayName, email)}
        </span>
      )}
    </div>
  );
}

/** First letters of the first two name words, falling back to the email. */
function initials(displayName: string | null, email: string): string {
  const words = displayName?.split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0) {
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase() || "??";
}
