import { describe, expect, it } from "vitest";

import { EnvError, parseEnv, parseHosts } from "../env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
};

describe("parseEnv", () => {
  it("returns the URL and the publishable key", () => {
    expect(parseEnv(valid)).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_abc",
    });
  });

  it("rejects a missing or non-http URL", () => {
    for (const url of [undefined, "", "project.supabase.co", "ftp://project.supabase.co"]) {
      expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(EnvError);
    }
  });

  it("rejects a key that is not a publishable key", () => {
    for (const key of [undefined, "", "sb_secret_abc", "eyJhbGciOiJIUzI1NiJ9.e30.x"]) {
      expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable key",
      );
    }
  });
});

describe("parseHosts", () => {
  it("names the service's origin and its admin host's, the port kept", () => {
    expect(parseHosts({ KNOWNO_SERVICE_ORIGIN: "https://knowno.app" })).toEqual({
      service: { origin: "https://knowno.app", host: "knowno.app" },
      admin: { origin: "https://admin.knowno.app", host: "admin.knowno.app" },
    });
    expect(parseHosts({ KNOWNO_SERVICE_ORIGIN: "http://localhost:3000" }).admin).toEqual({
      origin: "http://admin.localhost:3000",
      host: "admin.localhost:3000",
    });
  });

  it("rejects a missing value, and one that is not an http(s) origin alone", () => {
    for (const origin of [
      undefined,
      "",
      "knowno.app",
      "ftp://knowno.app",
      "https://knowno.app/",
      "https://knowno.app/admin",
      "https://knowno.app?x=1",
    ]) {
      expect(() => parseHosts({ KNOWNO_SERVICE_ORIGIN: origin }), String(origin)).toThrow(
        "KNOWNO_SERVICE_ORIGIN is not an http(s) origin",
      );
    }
  });
});
