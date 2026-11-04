import { User } from "lucide-react";
import Link from "next/link";

import { getSession } from "@/features/account";

/** The signed-in account's initial, as the phone's profile button draws it, or null without one. */
export async function readInitial(): Promise<string | null> {
  const session = await getSession();
  const first = session.kind === "signed-in" ? session.email.at(0) : undefined;
  return first ? first.toLocaleUpperCase() : null;
}

/**
 * The account's [initial] in a round button over its edge, which opens 설정, as the phone's
 * profile button: a person's outline without one. On the hero [onHero] it takes the hero's
 * button colours and is named 설정; in the side menu, [labelled], 설정 is written beside it.
 */
export function ProfileButton({
  initial,
  onHero = false,
  labelled = false,
}: {
  initial: string | null;
  onHero?: boolean;
  labelled?: boolean;
}) {
  const circle = (
    <span
      aria-hidden
      className={`flex size-tap-target shrink-0 items-center justify-center rounded-full text-body-strong ${onHero ? "bg-hero-button text-on-hero-button shadow-[0_var(--spacing-edge-row)_0_var(--color-on-hero-edge)]" : "bg-surface text-accent shadow-row"}`}
    >
      {initial ?? <User className="size-5" strokeWidth={2.2} />}
    </span>
  );
  return (
    <Link
      href="/account"
      aria-label={labelled ? undefined : "설정"}
      className={`pressable flex items-center gap-3 rounded-field focus-visible:outline-2 focus-visible:outline-offset-2 ${onHero ? "focus-visible:outline-on-hero" : "focus-visible:outline-ink"} ${labelled ? "min-h-tap-target text-label text-ink-2" : "rounded-full"}`}
    >
      {circle}
      {labelled && "설정"}
    </Link>
  );
}

/** [ProfileButton] for the side menu, with the session's initial. */
export async function SideProfile() {
  return <ProfileButton initial={await readInitial()} labelled />;
}
