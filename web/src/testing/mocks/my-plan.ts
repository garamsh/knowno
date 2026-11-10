import { http, HttpResponse } from "msw";

import { supabaseUrl } from "./handlers";

/** What `my_plan()` answers for each kind of user, with [fields] changed. */
export function planRow(
  kind: "free" | "plus-store" | "pro-store" | "admin" | "unlimited",
  fields: Record<string, unknown> = {},
) {
  const rows = {
    free: { plan: "free", source: "none", photo_limit: 10, period: "month", used: 3 },
    "plus-store": {
      plan: "pro",
      source: "store",
      ends_at: "2026-12-01T00:00:00Z",
      renews: true,
      photo_limit: 100,
      period: "month",
      used: 7,
    },
    "pro-store": {
      plan: "max",
      source: "store",
      ends_at: "2026-12-01T00:00:00Z",
      renews: false,
      photo_limit: 300,
      period: "month",
      used: 9,
    },
    admin: { plan: "max", source: "admin", photo_limit: null, period: "day", used: 4 },
    unlimited: { plan: "max", source: "unlimited", photo_limit: null, period: "day", used: 4 },
  };
  return { ends_at: null, renews: false, ...rows[kind], ...fields };
}

/** `my_plan()` answering one row for the signed-in user. */
export function myPlan(row: ReturnType<typeof planRow>) {
  return http.post(`${supabaseUrl}/rest/v1/rpc/my_plan`, () => HttpResponse.json([row]));
}
