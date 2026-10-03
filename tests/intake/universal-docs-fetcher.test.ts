import { describe, it, expect } from "vitest";
import { UniversalDocsFetcher } from "@/core/intake/universal-docs-fetcher";

describe("UniversalDocsFetcher — Dynamic Primary Source Scoring", () => {
  it("deve pontuar subdomínios e caminhos oficiais como alta autoridade de fonte primária", () => {
    const resDocs = UniversalDocsFetcher.scoreUrlAuthority("https://docs.stripe.com/api");
    expect(resDocs.score).toBeGreaterThanOrEqual(50);
    expect(resDocs.isPrimary).toBe(true);

    const resNpm = UniversalDocsFetcher.scoreUrlAuthority("https://www.npmjs.com/package/express");
    expect(resNpm.isPrimary).toBe(true); // 10 base + 40 pacote = 50
    expect(resNpm.score).toBe(50);

    const resGithub = UniversalDocsFetcher.scoreUrlAuthority("https://github.com/prisma/prisma/readme");
    expect(resGithub.score).toBeGreaterThanOrEqual(50);
    expect(resGithub.isPrimary).toBe(true);
  });

  it("deve penalizar e pontuar negativamente content farms e blogs informais", () => {
    const resMedium = UniversalDocsFetcher.scoreUrlAuthority("https://medium.com/@user/como-usar-stripe-123");
    expect(resMedium.score).toBeLessThan(0);
    expect(resMedium.isPrimary).toBe(false);
  });

  it("deve sanitizar HTML de documentação eliminando tags, scripts e menus", () => {
    const rawHtml = `
      <header>Menu de Navegação</header>
      <nav><a href="#">Docs</a></nav>
      <main><h1>Stripe API v1</h1><p>Endpoint POST /v1/charges para cobranças.</p></main>
      <footer>Direitos Reservados</footer>
    `;

    const sanitized = UniversalDocsFetcher.sanitizeDocHtml(rawHtml);
    expect(sanitized).toContain("Stripe API v1");
    expect(sanitized).not.toContain("<header>");
    expect(sanitized).not.toContain("<nav>");
    expect(sanitized).not.toContain("<footer>");
  });
});
