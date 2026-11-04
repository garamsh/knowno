/** A key hint beside a control's name, left out of the name screen readers announce. */
export function Hint({ children }: { children: string }) {
  return (
    <kbd aria-hidden className="font-sans text-caption font-normal opacity-80">
      {children}
    </kbd>
  );
}
