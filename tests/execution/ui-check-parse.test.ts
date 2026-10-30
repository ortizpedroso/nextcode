import { describe, it, expect } from "vitest";
import { parseNextBuildErrors } from "@/core/execution/ui-check";

describe("parseNextBuildErrors", () => {
  it("lê import trace do next build (Prisma / webpack)", () => {
    const log = `Failed to compile.

Module not found: Can't resolve '.prisma/client/index-browser'

Import trace for requested module:
./src/lib/prisma.ts
./src/lib/tarifas.ts
./src/app/dashboard/produtos/page.tsx

> Build failed because of webpack errors`;
    const errs = parseNextBuildErrors(log);
    expect(errs).toHaveLength(1);
    expect(errs[0].arquivo).toBe("src/app/dashboard/produtos/page.tsx");
    expect(errs[0].mensagem).toContain("Module not found");
  });

  it("lê Type error de rota App Router (Next 15)", () => {
    const log = `Failed to compile.

src/app/api/auth/[...nextauth]/route.ts
Type error: Route "src/app/api/auth/[...nextauth]/route.ts" has an invalid "GET" export:
  Type "{ params: { nextauth: string[]; }; }" is not a valid type`;
    const errs = parseNextBuildErrors(log);
    expect(errs[0].arquivo).toBe("src/app/api/auth/[...nextauth]/route.ts");
    expect(errs[0].mensagem).toContain("invalid");
  });
});
