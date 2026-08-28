import { defineConfig } from "vitest/config";

/**
 * Tests come from `src` only.
 *
 * `npm run build` compiles every .test.ts into dist alongside the code, and
 * vitest collects those too by default — so after a build, `npm run test` ran
 * each suite twice: once from source and once from a compiled copy that is only
 * as fresh as the last build.
 *
 * Both copies passing hides nothing, which is what makes it worth pinning down:
 * the failure mode is a stale dist suite passing against code that has since
 * changed, or failing against a bug already fixed in src, and either way the
 * report names a file nobody edits.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
