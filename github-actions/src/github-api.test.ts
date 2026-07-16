import { describe, it, expect } from "vitest";
import { classifyFetchError, probeCwd } from "./github-api";
import type { ExtensionContext } from "@silo-code/sdk";

describe("classifyFetchError", () => {
  it("classifies auth failures as unauthenticated", () => {
    expect(classifyFetchError("HTTP 401: Bad credentials").kind).toBe("unauthenticated");
    expect(classifyFetchError("HTTP 403: Forbidden").kind).toBe("unauthenticated");
    expect(classifyFetchError("authentication required").kind).toBe("unauthenticated");
    expect(classifyFetchError("You are not logged into any GitHub hosts").kind).toBe("unauthenticated");
  });

  it("classifies 404 as not-found", () => {
    expect(classifyFetchError("HTTP 404: Not Found").kind).toBe("not-found");
  });

  it("classifies rate limiting", () => {
    expect(classifyFetchError("HTTP 429: too many requests").kind).toBe("rate-limited");
    expect(classifyFetchError("API rate limit exceeded").kind).toBe("rate-limited");
  });

  it("falls back to network for anything else", () => {
    const err = classifyFetchError("could not resolve host: api.github.com");
    expect(err.kind).toBe("network");
    expect(err.message).toBe("could not resolve host: api.github.com");
  });

  it("uses a fallback message when stderr is empty", () => {
    expect(classifyFetchError("   ")).toEqual({ kind: "network", message: "gh api call failed" });
  });

  it("prefers unauthenticated when a 403 also mentions a rate limit", () => {
    // re-auth is the actionable fix, so the auth check wins the ordering
    expect(classifyFetchError("HTTP 403: rate limit exceeded").kind).toBe("unauthenticated");
  });
});

function mockCtx(over: {
  activeId?: string | null;
  open?: Array<{ id: string; folder: string }>;
  all?: Array<{ id: string; folder: string }>;
  os?: "macos" | "linux" | "windows";
}): ExtensionContext {
  const open = over.open ?? [];
  const all = over.all ?? open;
  const byId = new Map([...open, ...all].map((w) => [w.id, w]));
  return {
    workspaces: {
      getState: () => ({
        activeId: over.activeId ?? null,
        open,
        all,
        closed: [],
        hydrated: true,
      }),
      get: (id: string) => byId.get(id),
    },
    system: {
      getInfo: async () => ({ os: over.os ?? "macos", arch: "aarch64", siloVersion: "0.0.0" }),
    },
  } as unknown as ExtensionContext;
}

describe("probeCwd", () => {
  it("prefers the active workspace folder", async () => {
    const cwd = await probeCwd(
      mockCtx({
        activeId: "a",
        open: [
          { id: "a", folder: "/work/a" },
          { id: "b", folder: "/work/b" },
        ],
      }),
    );
    expect(cwd).toBe("/work/a");
  });

  it("falls back to any open workspace when none is active", async () => {
    const cwd = await probeCwd(
      mockCtx({
        activeId: null,
        open: [{ id: "b", folder: "/work/b" }],
      }),
    );
    expect(cwd).toBe("/work/b");
  });

  it("uses a platform root when no workspaces exist", async () => {
    await expect(probeCwd(mockCtx({ activeId: null, open: [], os: "macos" }))).resolves.toBe("/");
    await expect(probeCwd(mockCtx({ activeId: null, open: [], os: "windows" }))).resolves.toBe("C:\\");
  });
});
