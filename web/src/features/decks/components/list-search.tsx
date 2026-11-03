import { Search } from "lucide-react";

/** The search field under a list page's header, always shown, named and hinted [label]. */
export function ListSearch({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <label className="flex h-search items-center gap-2 rounded-field border border-outline bg-surface px-4 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ink">
      <Search aria-hidden className="size-5 shrink-0 text-ink-2" strokeWidth={2.4} />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => {
          change(event.target.value);
        }}
        className="min-w-0 flex-1 bg-transparent text-body placeholder:text-muted focus-visible:outline-none"
      />
    </label>
  );
}
