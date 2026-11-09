import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(new URL("./.build/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("./authorization.test.mjs", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: new URL("./.build/authorization.test.mjs", import.meta.url).pathname,
  external: [
    "express",
    "pg",
    "drizzle-orm",
    "drizzle-orm/*",
  ],
});
