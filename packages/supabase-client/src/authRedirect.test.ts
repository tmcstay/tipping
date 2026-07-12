import assert from "node:assert/strict";
import test from "node:test";

import { getAppOrigin, getAuthRedirectUrl } from "./authRedirect.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

function withDev(isDev: boolean, fn: () => void) {
  const globalAny = globalThis as unknown as { __DEV__?: boolean };
  const original = globalAny.__DEV__;
  globalAny.__DEV__ = isDev;
  try {
    fn();
  } finally {
    globalAny.__DEV__ = original;
  }
}

test("getAppOrigin returns the configured production origin, with a trailing slash stripped", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: "https://grandtour-three.vercel.app/" }, () => {
    withDev(false, () => {
      assert.equal(getAppOrigin(), "https://grandtour-three.vercel.app");
    });
  });
});

test("getAppOrigin falls back to localhost:8081 in local development when unset", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: undefined }, () => {
    withDev(true, () => {
      assert.equal(getAppOrigin(), "http://localhost:8081");
    });
  });
});

test("getAppOrigin allows a localhost EXPO_PUBLIC_APP_URL in development", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: "http://localhost:8081" }, () => {
    withDev(true, () => {
      assert.equal(getAppOrigin(), "http://localhost:8081");
    });
  });
});

test("getAppOrigin rejects a localhost EXPO_PUBLIC_APP_URL outside development", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: "http://localhost:8081" }, () => {
    withDev(false, () => {
      assert.throws(() => getAppOrigin(), /localhost origin in a non-development build/);
    });
  });
});

test("getAppOrigin rejects a missing EXPO_PUBLIC_APP_URL outside development (never silently falls back to localhost)", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: undefined }, () => {
    withDev(false, () => {
      assert.throws(() => getAppOrigin(), /EXPO_PUBLIC_APP_URL is not set/);
    });
  });
});

test("getAuthRedirectUrl joins the origin and path with exactly one slash, regardless of leading slashes in the path", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: "https://grandtour-three.vercel.app" }, () => {
    withDev(false, () => {
      assert.equal(getAuthRedirectUrl("/auth/callback"), "https://grandtour-three.vercel.app/auth/callback");
      assert.equal(getAuthRedirectUrl("auth/callback"), "https://grandtour-three.vercel.app/auth/callback");
      assert.equal(getAuthRedirectUrl("//auth/callback"), "https://grandtour-three.vercel.app/auth/callback");
    });
  });
});

test("getAuthRedirectUrl builds the reset-password path", () => {
  withEnv({ EXPO_PUBLIC_APP_URL: "https://grandtour-three.vercel.app" }, () => {
    withDev(false, () => {
      assert.equal(getAuthRedirectUrl("/reset-password"), "https://grandtour-three.vercel.app/reset-password");
    });
  });
});
