/**
 * What RevenueCat says a user is entitled to now: `GET /v1/subscribers/{app_user_id}` with the
 * secret API key (ADR 0241). An event is only a trigger; the plan comes from this read, so a
 * replayed, duplicated or out-of-order event cannot leave a wrong one.
 */

const API = "https://api.revenuecat.com/v1/subscribers/";

/** The entitlement that gives plan Pro, shown as 플러스; the plan versions and limits are ADR 0097's. */
export const ENTITLEMENT = "plus";

/** Raised when RevenueCat cannot be reached or answers in a shape the function does not expect. */
export class RevenueCatError extends Error {
  override name = "RevenueCatError";
}

/** Plan `pro` until [endsAt] (null for no end) and renewing there, or `null` for no active entitlement. */
export type Entitlement =
  | { readonly plan: null }
  | {
    readonly plan: "pro";
    readonly endsAt: string | null;
    readonly renews: boolean;
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A date field of a RevenueCat object: an ISO timestamp, or null when absent. */
function date(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) {
    throw new RevenueCatError(`RevenueCat answered a bad ${key}`);
  }
  return time;
}

/**
 * The entitlement `plus` of [appUserId], active when it exists and its end, the later of
 * `expires_date` and `grace_period_expires_date`, is absent or after [now]. It renews while its
 * subscription has an end and no unsubscribe was detected. Throws [RevenueCatError] when RevenueCat
 * cannot be reached or does not answer 200 with the shape; the key is in no message.
 */
export async function read(
  appUserId: string,
  apiKey: string,
  now: number,
  fetchImpl: typeof fetch,
): Promise<Entitlement> {
  const response = await fetchImpl(API + encodeURIComponent(appUserId), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }).catch((cause: unknown) => {
    throw new RevenueCatError("RevenueCat could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new RevenueCatError(`RevenueCat answered ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !isRecord(body.subscriber)) {
    throw new RevenueCatError("RevenueCat answered no subscriber");
  }
  const entitlements = body.subscriber.entitlements;
  if (!isRecord(entitlements)) {
    throw new RevenueCatError("RevenueCat answered no entitlements");
  }
  const entitlement = entitlements[ENTITLEMENT];
  if (entitlement === undefined) return { plan: null };
  if (!isRecord(entitlement)) {
    throw new RevenueCatError("RevenueCat answered a bad entitlement");
  }
  const expires = date(entitlement, "expires_date");
  const grace = date(entitlement, "grace_period_expires_date");
  // No expires_date is a purchase with no end; a grace period only lengthens one that has.
  const end = expires === null ? null : Math.max(expires, grace ?? expires);
  if (end !== null && end <= now) return { plan: null };
  const subscriptions = body.subscriber.subscriptions;
  const product = entitlement.product_identifier;
  const subscription = isRecord(subscriptions) && typeof product === "string"
    ? subscriptions[product]
    : undefined;
  const unsubscribed = isRecord(subscription) &&
    date(subscription, "unsubscribe_detected_at") !== null;
  return {
    plan: "pro",
    endsAt: end === null ? null : new Date(end).toISOString(),
    renews: end !== null && !unsubscribed,
  };
}
