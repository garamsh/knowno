"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { buttonClass } from "@/design/button";
import { Chip } from "@/design/chip";

import { previewOf } from "../card-preview";
import type { ShownProposal } from "../conversation";
import { type Format, formats, type ProposalGroup } from "../protocol";

/** Each card form in the words the chat's choices use (#711). */
export const formatNames: Record<Format, string> = {
  text: "글",
  senses: "단어",
  cloze: "빈칸 문장",
  table: "표",
  image: "사진",
  mixed: "섞어서",
};

/** A group of more cards than this starts collapsed to its count and form. */
const collapsedFrom = 6;

/** The forms a group can be remade in from the chat: each but its own and a photo's. */
const remakeFormats = formats.filter((format) => format !== "image");

/** A check whose state may be partial: a group with some of its cards checked. */
function GroupCheck({
  checked,
  partial,
  label,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
      className="size-5 shrink-0 accent-primary"
    />
  );
}

/**
 * One group of a proposal: its check over its cards, its title and form chip, "다른 형식으로",
 * which offers the other forms, and its cards, each with its own check, collapsed to "카드 n장 ·
 * form" past five cards until opened. Once [added], the checks are gone.
 */
function GroupView({
  group,
  checked,
  added,
  disabled,
  onCheck,
  onRemake,
}: {
  group: ProposalGroup;
  checked: readonly string[];
  added: boolean;
  disabled: boolean;
  onCheck: (ids: string[]) => void;
  onRemake: (format: Format) => void;
}) {
  const [open, setOpen] = useState(group.cards.length < collapsedFrom);
  const [remaking, setRemaking] = useState(false);
  const all = group.cards.map((card) => card.id);
  const count = `카드 ${String(group.cards.length)}장 · ${formatNames[group.format]}`;
  return (
    <section aria-label={group.title} className="flex flex-col">
      <div className="flex min-h-tap-target items-center gap-3 px-4 pt-3">
        {!added && (
          <GroupCheck
            label={`${group.title} 모두 선택`}
            checked={checked.length === all.length}
            partial={checked.length > 0 && checked.length < all.length}
            onChange={(on) => {
              onCheck(on ? all : []);
            }}
          />
        )}
        <h3 className="min-w-0 flex-1 text-body-strong break-keep">{group.title}</h3>
        <Chip tone="brand">{formatNames[group.format]}</Chip>
      </div>
      {!added && (
        <div className="flex flex-wrap items-center gap-2 px-4">
          <button
            type="button"
            aria-expanded={remaking}
            disabled={disabled}
            onClick={() => {
              setRemaking(!remaking);
            }}
            className={buttonClass("text", "header")}
          >
            다른 형식으로
          </button>
          {remaking &&
            remakeFormats
              .filter((format) => format !== group.format)
              .map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setRemaking(false);
                    onRemake(format);
                  }}
                  className={buttonClass("secondary", "header")}
                >
                  {formatNames[format]}
                </button>
              ))}
        </div>
      )}
      {open ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {group.cards.map((card) => {
            const { front, back } = previewOf(card.card);
            const on = checked.includes(card.id);
            const lines = (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-strong break-keep">{front || "—"}</span>
                {back && <span className="text-secondary break-keep text-muted">{back}</span>}
              </span>
            );
            return (
              <li key={card.id}>
                {added ? (
                  <div className="flex px-4 py-3">{lines}</div>
                ) : (
                  <label className="pressable flex min-h-tap-target cursor-pointer items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        onCheck(
                          on ? checked.filter((id) => id !== card.id) : [...checked, card.id],
                        );
                      }}
                      className="mt-0.5 size-5 shrink-0 accent-primary"
                    />
                    {lines}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
          }}
          className="pressable flex min-h-tap-target items-center justify-between gap-3 px-4 py-3 text-left text-body"
        >
          {count}
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </button>
      )}
    </section>
  );
}

/**
 * A proposal in the chat (#711): its note, then its groups in one surface, hairlines between them;
 * once added, the shortcut to the note it wrote, its name and the cards written, which opens it.
 */
export function ProposalView({
  shown,
  disabled,
  onCheck,
  onRemake,
}: {
  shown: ShownProposal;
  disabled: boolean;
  onCheck: (groupId: string, ids: string[]) => void;
  onRemake: (group: ProposalGroup, format: Format) => void;
}) {
  const { proposal, checked, added } = shown;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-group bg-surface pb-1">
        <p className="flex min-h-tap-target items-center gap-2 px-4 pt-3 text-secondary text-muted">
          {proposal.deck.id === null ? `새 노트 · ${proposal.deck.name}` : proposal.deck.name}
        </p>
        {proposal.groups.map((group) => (
          <GroupView
            key={group.id}
            group={group}
            checked={checked[group.id] ?? []}
            added={added !== null}
            disabled={disabled}
            onCheck={(ids) => {
              onCheck(group.id, ids);
            }}
            onRemake={(format) => {
              onRemake(group, format);
            }}
          />
        ))}
      </div>
      {added && (
        <Link
          href={`/decks/${encodeURIComponent(added.deck.id)}`}
          className="pressable flex min-h-button items-center gap-3 rounded-row bg-surface px-4 py-3 shadow-row"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body-strong break-keep">{added.deck.name}</span>
            <span className="text-secondary text-muted">카드 {added.count}장</span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
        </Link>
      )}
    </div>
  );
}
