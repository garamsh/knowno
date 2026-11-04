"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, startTransition, useActionState, useId, useState } from "react";

import { signOut, type SignOutState } from "@/features/account/actions";
import { buttonClass } from "@/design/button";
import { Chip } from "@/design/chip";
import { useModalDialog } from "@/design/sheet";
import { leaveThen } from "@/design/use-back-entry";

import { AdminBrand } from "./admin-brand";
import { Email, switchLink } from "./admin-section";

/**
 * The admin area's six sections on the admin host, one per job (ADR 0178, ADR 0181), each with the
 * paths it is current on.
 */
const sections = [
  { href: "/", label: "처리할 일", current: (path: string) => path === "/" },
  { href: "/users", label: "사용자", current: (path: string) => path.startsWith("/users") },
  { href: "/decks", label: "노트", current: (path: string) => path.startsWith("/decks") },
  { href: "/ai", label: "AI", current: (path: string) => path === "/ai" },
  { href: "/plans", label: "요금제", current: (path: string) => path === "/plans" },
  { href: "/admins", label: "관리자", current: (path: string) => path === "/admins" },
] as const;

/** What the shell shows besides the page: the open reports' count, the account and the service. */
type Account = {
  /** The open reports' count, or null while it could not be read, which 처리할 일 then says. */
  openReports: number | null;
  /** The signed-in admin's email. */
  email: string;
  /** The service's address, which "서비스 열기" opens, or null where the request did not name it. */
  serviceUrl: string | null;
};

/**
 * 로그아웃, held by the shell so it outlives the full-screen menu that may start it: its state,
 * its dispatch and whether it runs.
 */
type SignOut = {
  state: SignOutState;
  action: () => void;
  pending: boolean;
};

/**
 * Where a link of the full-screen menu goes: the menu's history entry is dropped first, then the
 * menu closes and the page opens, as the phone pops a route before it pushes the next.
 */
type Leave = (then: () => void) => void;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * The admin host's shell (ADR 0178), with none of the service's menus: from 1024 px a side menu
 * beside the page, pinned as it scrolls, holding the brand over "관리", the six sections and at its
 * foot the account, "서비스 열기" and 로그아웃; below 1024 px a bar over the page holding the
 * brand and "메뉴", which opens the same menu as a full screen. The skip link leads past them to
 * the page, whose Korean breaks only between words.
 */
export function AdminShell({ children, ...account }: Account & { children: ReactNode }) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, action, pending] = useActionState(signOut, { error: null });
  const signingOut: SignOut = { state, action, pending };
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-button focus:bg-surface focus:px-4 focus:py-3 focus:text-label focus:text-ink focus:outline-2 focus:outline-ink"
      >
        본문으로 건너뛰기
      </a>
      <div className="hidden w-60 shrink-0 border-r border-hairline bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto px-4 py-7">
          <Brand />
          <nav aria-label="관리 메뉴">
            <Sections path={path} openReports={account.openReports} />
          </nav>
          <Foot {...account} signOut={signingOut} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-hairline bg-surface px-gutter py-2 lg:hidden">
          <Brand />
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setMenuOpen(true);
            }}
            className={buttonClass("secondary", "header")}
          >
            메뉴
          </button>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-content flex-1 flex-col gap-5 px-gutter pt-6 pb-12 break-keep focus:outline-none lg:px-8 lg:pt-8"
        >
          {children}
        </main>
      </div>
      {menuOpen && (
        <MenuScreen
          path={path}
          {...account}
          signOut={signingOut}
          close={() => {
            setMenuOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The menu below 1024 px, the whole screen, named 관리 메뉴, closed by "닫기", Escape or the back. */
function MenuScreen({
  path,
  close,
  signOut: signingOut,
  ...account
}: Account & { path: string; close: () => void; signOut: SignOut }) {
  const dialog = useModalDialog(close);
  const heading = useId();
  const router = useRouter();
  const leave: Leave = (then) => {
    leaveThen(() => {
      close();
      then();
    });
  };
  return (
    <dialog
      {...dialog}
      aria-labelledby={heading}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-surface p-0 break-keep text-ink lg:hidden"
    >
      <div className="flex min-h-full flex-col gap-5 px-gutter pt-2 pb-7">
        <header className="flex items-center justify-between gap-3">
          <h2 id={heading} className="text-title">
            관리 메뉴
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            className={`pressable flex size-tap-target shrink-0 items-center justify-center rounded-button ${focus}`}
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>
        <nav aria-label="관리 메뉴">
          <Sections
            path={path}
            openReports={account.openReports}
            onNavigate={(href) => {
              leave(() => {
                router.push(href);
              });
            }}
          />
        </nav>
        <Foot {...account} signOut={signingOut} leave={leave} />
      </div>
    </dialog>
  );
}

/** The brand's lockup over "관리", the area's name, opening 처리할 일. */
function Brand() {
  return (
    <Link
      href="/"
      aria-label="알아몰라 관리, 처리할 일"
      className={`self-start rounded-field ${focus}`}
    >
      <AdminBrand />
    </Link>
  );
}

/**
 * The six sections, the current one in `accent` on the brand tint, 처리할 일 carrying the open
 * reports' count; [onNavigate] takes a link's press where the menu must close first.
 */
function Sections({
  path,
  openReports,
  onNavigate,
}: {
  path: string;
  openReports: number | null;
  onNavigate?: (href: string) => void;
}) {
  return (
    // Apart by more than the current item's edge, so the edge never lies under the next item.
    <ul className="flex flex-col gap-2">
      {sections.map(({ href, label, current }) => {
        const selected = current(path);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={
                onNavigate &&
                ((event) => {
                  event.preventDefault();
                  onNavigate(href);
                })
              }
              aria-current={selected ? "page" : undefined}
              className={`${switchLink(selected)} justify-between gap-2`}
            >
              {label}
              {href === "/" && openReports !== null && openReports > 0 && (
                <Chip>
                  <span className="sr-only">, 새 신고 </span>
                  {openReports}
                  <span className="sr-only">건</span>
                </Chip>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The menu's foot: the account's email, "서비스 열기" in a new tab, and 로그아웃, which ends this
 * host's session alone and opens its sign-in; [leave] closes the full-screen menu first.
 */
function Foot({
  email,
  serviceUrl,
  signOut: { state, action, pending },
  leave,
}: Account & { signOut: SignOut; leave?: Leave }) {
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-3">
      <p className="px-1 text-caption break-words text-muted">
        <Email email={email} />
      </p>
      {serviceUrl !== null && (
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener"
          className={`${buttonClass("text", "header")} justify-start gap-1.5 self-start`}
        >
          서비스 열기
          <ExternalLink aria-hidden className="size-4" strokeWidth={2.2} />
          <span className="sr-only">, 새 탭</span>
        </a>
      )}
      <form
        action={action}
        onSubmit={(event) => {
          if (!leave) return;
          event.preventDefault();
          leave(() => {
            startTransition(action);
          });
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`${buttonClass("text", "header")} justify-start`}
        >
          로그아웃
        </button>
      </form>
      {state.error && (
        <p role="alert" className="px-1 text-caption text-dont-know-text">
          {state.error}
        </p>
      )}
    </div>
  );
}
