import { build } from "esbuild";

// `react`, `react/jsx-runtime`, and `@silo-code/sdk` are external — the Silo host
// resolves them to its own instances at load time, so the extension shares one
// React (hooks work) and one SDK (services are singletons).
// `@phosphor-icons/react` is bundled so we don't depend on the host having it.
await build({
  entryPoints: ["src/index.tsx"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  minify: false,
  external: ["react", "react/jsx-runtime", "@silo-code/sdk"],
  logLevel: "info",
});
