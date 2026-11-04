"use client";

import { useEffect, useState } from "react";
import { readCardKeys } from "../actions";
import { frameKey } from "../authoring";
import { parseCells } from "../card-content";
import type { Candidate } from "../photo-candidates";
import {
  cardsOf,
  defaultForm,
  formFor,
  readForms,
  type Section,
  type SectionForm,
} from "../section-form";

/**
 * The review of the read photos' [sections] before saving: the deck the cards go into, from
 * [deckId] or "new", each section's form, which cards the deck holds already, which are included,
 * and the collapsed groups.
 */
export function usePhotoReview(deckId: string, sections: Section[]) {
  const [target, setTarget] = useState<string>(deckId);
  // Each section's form once set, by section id; one not set takes the deck's remembered form.
  const [forms, setForms] = useState<Record<string, SectionForm>>({});
  const [remembered] = useState(readForms);
  // The card keys the chosen deck holds, by deck id; a deck not read yet marks nothing.
  const [held, setHeld] = useState<Record<string, ReadonlySet<string>>>({});
  useEffect(() => {
    if (target === "new") return;
    let current = true;
    // A deck whose keys cannot be read marks nothing, and a duplicate merges on saving.
    void readCardKeys(target)
      .catch(() => null)
      .then((keys) => {
        if (current && keys) setHeld((all) => ({ ...all, [target]: new Set(keys) }));
      });
    return () => {
      current = false;
    };
  }, [target]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function formOf(section: Section): SectionForm {
    return (
      forms[section.id] ??
      formFor(section, remembered[target]?.[section.key]) ??
      defaultForm(section.kind, section.identify)
    );
  }
  function changeForm(section: Section, form: SectionForm) {
    setForms({ ...forms, [section.id]: form });
  }
  /** Whether the chosen deck holds [card]'s first card in its form, as the phone's `isDuplicate`. */
  function inDeck(card: Candidate, section: Section): boolean {
    const [first] = cardsOf(card, formOf(section));
    return !!first && !!held[target]?.has(frameKey(parseCells(first.blocks) ?? []));
  }
  /** Whether [card] is saved: as the user set it, else unless it is an identify card or in the deck. */
  function included(card: Candidate, section: Section): boolean {
    return card.selected ?? (!card.identify && !inDeck(card, section));
  }
  // The cards saving writes: each included candidate's, in its section's form.
  const toSave = sections.flatMap((section) =>
    section.cards
      .filter((card) => included(card, section))
      .flatMap((card) => cardsOf(card, formOf(section))),
  );
  // One per card key, as the phone's `cardCount`: cards of one key merge into one.
  const cardCount = new Set(toSave.map((card) => frameKey(parseCells(card.blocks) ?? []))).size;
  /** Chooses the deck the cards go into, taking that deck's remembered forms where it has them. */
  function chooseTarget(next: string) {
    setForms(
      Object.fromEntries(
        sections.map((section) => [
          section.id,
          formFor(section, remembered[next]?.[section.key]) ?? formOf(section),
        ]),
      ),
    );
    setTarget(next);
  }
  function toggleGroup(id: string) {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
  }

  return {
    target,
    chooseTarget,
    formOf,
    changeForm,
    inDeck,
    included,
    toSave,
    cardCount,
    collapsed,
    toggleGroup,
  };
}
