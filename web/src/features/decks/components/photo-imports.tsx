"use client";

import { createContext, type ReactNode, use, useState } from "react";
import type { Deck } from "../library";
import { PhotoImport } from "./photo-import";

/** Another way to add a note's cards, which an unavailable photo import offers in its place. */
export type AddInstead = (way: "manual" | "file") => void;

/** The tab's one photo import: the deck it adds to and the photos it reads. */
type Job = { id: number; deck: Deck; camera: boolean; files: File[]; addInstead: AddInstead };

type PhotoImportsValue = {
  /**
   * Starts reading [files] into [deck] and shows the import, or, while one is under way, shows that
   * one and reads nothing new.
   */
  start: (deck: Deck, camera: boolean, files: File[], addInstead: AddInstead) => void;
  /** Shows the import under way; null while there is none. */
  open: (() => void) | null;
};

const PhotoImportsContext = createContext<PhotoImportsValue | null>(null);

/**
 * The tab's photo import, which belongs to the tab rather than to a page: it reads on while the
 * user goes to any page, study included, and its bar heads every page while its screen is closed
 * (ADR 0183). Reloading or closing the tab ends it.
 */
export function PhotoImports({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const [shown, setShown] = useState(false);
  const [next, setNext] = useState(0);
  const value: PhotoImportsValue = {
    start(deck, camera, files, addInstead) {
      if (!job) {
        setJob({ id: next, deck, camera, files, addInstead });
        setNext(next + 1);
      }
      setShown(true);
    },
    open: job
      ? () => {
          setShown(true);
        }
      : null,
  };
  return (
    <PhotoImportsContext value={value}>
      {job && (
        <PhotoImport
          key={job.id}
          deck={job.deck}
          camera={job.camera}
          files={job.files}
          shown={shown}
          open={() => {
            setShown(true);
          }}
          hide={() => {
            setShown(false);
          }}
          close={() => {
            setJob(null);
            setShown(false);
          }}
          addInstead={(way) => {
            setJob(null);
            setShown(false);
            job.addInstead(way);
          }}
        />
      )}
      {children}
    </PhotoImportsContext>
  );
}

/** The tab's photo import, which [PhotoImports] holds. */
export function usePhotoImports(): PhotoImportsValue {
  const value = use(PhotoImportsContext);
  if (!value) throw new Error("usePhotoImports is called outside PhotoImports");
  return value;
}
