import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/unit/**/*.test.ts"],
    env: {
      // unit tests must never reach a real database; anything that tries fails fast
      DATABASE_URL: "mysql://unit-tests@127.0.0.1:1/no_database",
    },
  },
});
