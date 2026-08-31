import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Local-development link to the SDK source — see the matching note in
      // tsconfig.json. Drop this once a published @silo-code/sdk carries
      // RFC 0032's storage-directory methods.
      "@silo-code/sdk": fileURLToPath(
        new URL("../../xerro-edit/packages/sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    name: "unit",
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
