// Reads a pin from a Cargo.lock, which scripts/check-generated.ts and scripts/wasm-bindgen.ts hold
// their code generators to.

/** The version a Cargo.lock pins a crate at; nothing where it does not name the crate. */
export function pinnedVersion(lock: string, crate: string): string {
  const lines = lock.split("\n");
  const at = lines.indexOf(`name = "${crate}"`);
  if (at < 0) return "";
  return lines[at + 1]?.match(/^version = "(.*)"$/)?.[1] ?? "";
}
