import { type ReactNode, useId } from "react";

/**
 * A label over a group, read as its heading, as the phone's `AppSectionLabel`: the `section` type,
 * muted, above an optional [note] for what the group does not say, over [children]. [id] names the
 * label where something inside the group is labelled by it too.
 */
export function Section({
  label,
  note,
  id,
  children,
}: {
  label: string;
  note?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  const ownId = useId();
  const labelId = id ?? ownId;
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-2">
      <h2 id={labelId} className="px-1 text-section text-muted">
        {label}
      </h2>
      {note !== undefined && <p className="px-1 text-caption text-muted">{note}</p>}
      {children}
    </section>
  );
}
