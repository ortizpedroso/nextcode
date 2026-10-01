import { beforeAll } from "vitest";

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./prisma/dev.db";
  }
  if (!process.env.NEXTCODE_AUTH_TOKEN) {
    process.env.NEXTCODE_AUTH_TOKEN = "test-token-secret-123";
  }
});
