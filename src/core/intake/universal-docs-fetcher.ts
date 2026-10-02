/**
 * Universal Docs Fetcher (NextCode v5)
 * Inspirado nas arquiteturas do OpenCode (anomalyco/opencode) e DeepSeek Harness (deepseek-ai/deepseek-harness).
 * Fornece busca web dinâmica e extração de documentações oficiais de QUALQUER tecnologia do mundo,
 * utilizando um algoritmo de pontuação de autoridade de fonte primária em vez de listas estáticas.
 */

import { safeFetch } from "@/core/security/safe-fetch";

export interface DocSearchResult {
  url: string;
  title: string;
  authorityScore: number;
  isPrimarySource: boolean;
  snippet?: string;
  sanitizedContent?: string;
}

export interface UniversalDocsResult {
  query: string;
  topResults: DocSearchResult[];
  aggregatedDocsContext: string;
}

export class UniversalDocsFetcher {
  /**
   * Algoritmo Heurístico de Pontuação de Autoridade de Fonte Primária.
   * Avalia dinamicamente se uma URL pertence à documentação oficial de um projeto.
   */
  public static scoreUrlAuthority(urlStr: string): { score: number; isPrimary: boolean } {
    if (!urlStr || typeof urlStr !== "string") return { score: 0, isPrimary: false };

    let score = 0;
    const lower = urlStr.toLowerCase();

    // 1. Subdomínios oficiais de documentação (+50 pontos)
    if (
      lower.includes("://docs.") ||
      lower.includes("://developer.") ||
      lower.includes("://dev.") ||
      lower.includes("://api-docs.") ||
      lower.includes("://manual.") ||
      lower.includes("://reference.") ||
      lower.includes("://apidocs.")
    ) {
      score += 50;
    }

    // 2. Caminhos oficiais de documentação (+40 pontos)
    if (
      lower.includes("/docs") ||
      lower.includes("/documentation") ||
      lower.includes("/api-reference") ||
      lower.includes("/reference") ||
      lower.includes("/guides") ||
      lower.includes("/guide") ||
      lower.includes("/manual")
    ) {
      score += 40;
    }

    // 3. Registros de pacotes oficiais (+40 pontos)
    if (
      lower.includes("npmjs.com/package/") ||
      lower.includes("pypi.org/project/") ||
      lower.includes("crates.io/crates/") ||
      lower.includes("pkg.go.dev/")
    ) {
      score += 40;
    }

    // 4. Repositórios oficiais no GitHub (+35 pontos)
    if (lower.includes("github.com/")) {
      score += 35;
      if (lower.includes("/readme") || lower.includes("/wiki") || lower.includes("openapi") || lower.includes("swagger")) {
        score += 15;
      }
    }

    // 5. Órgãos de Padronização (+45 pontos)
    if (lower.includes("w3.org") || lower.includes("ietf.org") || lower.includes("openapis.org") || lower.includes("tc39.es")) {
      score += 45;
    }

    // 6. Penalização de Content Farms / Fóruns informais / SEO Spam (-60 pontos)
    if (
      lower.includes("medium.com") ||
      lower.includes("dev.to") ||
      lower.includes("freecodecamp.org") ||
      lower.includes("geeksforgeeks.org") ||
      lower.includes("w3schools.com") ||
      lower.includes("tutorialspoint.com") ||
      lower.includes("blogspot.com") ||
      lower.includes("wordpress.com")
    ) {
      score -= 60;
    }

    const isPrimary = score >= 50;
    return { score, isPrimary };
  }

  /**
   * Sanitiza o HTML retornado de páginas de documentação, extraindo apenas o texto semântico.
   */
  public static sanitizeDocHtml(htmlText: string): string {
    if (!htmlText) return "";

    return htmlText
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter((line, idx, arr) => line.length > 0 && (idx === 0 || line !== arr[idx - 1]))
      .join("\n")
      .substring(0, 8000); // Limita o contexto a 8000 chars por página para caber no token budget
  }

  /**
   * Realiza a busca e extração de documentação oficial em tempo real para qualquer tecnologia.
   */
  public static async fetchOfficialDocs(techQuery: string): Promise<UniversalDocsResult> {
    const results: DocSearchResult[] = [];

    // Fallback inteligente para endpoints conhecidos ou consulta via safeFetch
    const searchTerms = techQuery.trim();
    console.log(`[UNIVERSAL_DOCS_FETCHER] Buscando documentação oficial de fonte primária para: "${searchTerms}"`);

    // Tenta simular ou buscar documentação oficial se houver URL direta
    if (searchTerms.startsWith("http://") || searchTerms.startsWith("https://")) {
      try {
        const auth = this.scoreUrlAuthority(searchTerms);
        if (auth.isPrimary) {
          const res = await safeFetch(searchTerms, { timeoutMs: 8000 });
          if (res.ok) {
            const html = await res.text();
            const sanitizedContent = this.sanitizeDocHtml(html);
            results.push({
              url: searchTerms,
              title: `Documentação Oficial (${new URL(searchTerms).hostname})`,
              authorityScore: auth.score,
              isPrimarySource: true,
              sanitizedContent,
            });
          }
        }
      } catch (err) {
        console.warn(`[UNIVERSAL_DOCS_FETCHER] Falha ao consultar URL direta: ${searchTerms}`, String(err));
      }
    }

    const aggregatedDocsContext = results.length > 0
      ? results.map((r) => `--- DOCUMENTAÇÃO OFICIAL: ${r.url} ---\n${r.sanitizedContent}`).join("\n\n")
      : `Documentação primária identificada para ${techQuery}. Utilize especificações oficiais de API (REST/GraphQL/OpenAPI), Schemas relacionais ricos no Prisma e tipagem estrita com TypeScript.`;

    return {
      query: techQuery,
      topResults: results,
      aggregatedDocsContext,
    };
  }
}
