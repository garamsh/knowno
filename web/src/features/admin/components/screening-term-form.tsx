"use client";

import { useState, useTransition } from "react";

import { addScreeningTerm } from "../screening-terms";
import { button, field, group } from "./admin-section";

/** Adds one banned word; the field empties once it is added. */
export function ScreeningTermForm() {
  const [term, setTerm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await addScreeningTerm(term);
          setMessage(result.message);
          if (result.changed) setTerm("");
        });
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="screening-term" className="px-1 text-section text-muted">
        금칙어 추가
      </label>
      <div className={group}>
        <input
          id="screening-term"
          value={term}
          maxLength={100}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          placeholder="공개를 막을 단어"
          className={`${field} h-button px-4`}
        />
      </div>
      <button type="submit" disabled={pending || term.trim() === ""} className={button.primary}>
        추가
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {message}
      </p>
    </form>
  );
}
