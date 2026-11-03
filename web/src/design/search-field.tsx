import { Search } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * The one search over a list, as the phone's `AppTextField` draws a search: `search` high on the
 * surface inside its outline, the search mark before it, named and hinted [label]. The rest is the
 * input's own: a value with its change, or a name and a default inside a form.
 */
export function SearchField({
  label,
  ...input
}: { label: string } & Omit<
  ComponentProps<"input">,
  "type" | "aria-label" | "placeholder" | "className"
>) {
  return (
    <label className="flex h-search items-center gap-2 rounded-field border border-outline bg-surface px-4 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ink">
      <Search aria-hidden className="size-5 shrink-0 text-ink-2" strokeWidth={2.4} />
      <input
        {...input}
        type="search"
        aria-label={label}
        placeholder={label}
        className="min-w-0 flex-1 bg-transparent text-body placeholder:text-muted focus-visible:outline-none"
      />
    </label>
  );
}
