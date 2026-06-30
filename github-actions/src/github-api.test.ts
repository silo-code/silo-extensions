import { describe, it, expect } from "vitest";
import { classifyFetchError } from "./github-api";

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
