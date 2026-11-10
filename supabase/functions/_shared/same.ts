/** A comparison of two secrets that takes the same time whatever they hold. */

/** The SHA-256 of [text]. */
export const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

/**
 * Whether [a] and [b] are the same text, in time that depends on neither's content: both are
 * hashed to 32 bytes, and every byte is compared whatever the first difference.
 */
export async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}
