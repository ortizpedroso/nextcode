/**
 * Universal Docs Fetcher (NextCode v5)
 * Inspirado nas arquiteturas do OpenCode (anomalyco/opencode) e DeepSeek Harness (deepseek-ai/deepseek-harness).
 * Fornece busca web REAL e dinâmica na internet e extração de documentações oficiais de QUALQUER assunto/tecnologia do mundo,
 * utilizando busca aberta com algoritmo de pontuação de autoridade de fonte primária em tempo real.
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
   * Avalia dinamicamente se uma URL pertence à documentação oficial de um projeto/tecnologia.
   */
  public static scoreUrlAuthority(urlStr: string): { score: number; isPrimary: boolean } {
    if (!urlStr || typeof urlStr !== "string") return { score: 0, isPrimary: false };

    let score = 10; // Pontuação base para qualquer site da web
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
   * Realiza a busca WEB REAL na internet e extrai a documentação oficial para QUALQUER assunto ou projeto do mundo.
   */
  public static async fetchOfficialDocs(techQuery: string): Promise<UniversalDocsResult> {
    const results: DocSearchResult[] = [];
    const searchTerms = techQuery.trim();
    console.log(`[UNIVERSAL_DOCS_FETCHER] Realizando busca web na internet para: "${searchTerms}"`);

    // 1. Se for uma URL direta enviada no prompt
    if (searchTerms.startsWith("http://") || searchTerms.startsWith("https://")) {
      try {
        const auth = this.scoreUrlAuthority(searchTerms);
        const res = await safeFetch(searchTerms, { timeoutMs: 8000 });
        if (res.ok) {
          const html = await res.text();
          const sanitizedContent = this.sanitizeDocHtml(html);
          results.push({
            url: searchTerms,
            title: `Documentação Fonte Primária (${new URL(searchTerms).hostname})`,
            authorityScore: auth.score,
            isPrimarySource: auth.isPrimary,
            sanitizedContent,
          });
        }
      } catch (err) {
        console.warn(`[UNIVERSAL_DOCS_FETCHER] Falha ao consultar URL direta: ${searchTerms}`, String(err));
      }
    }

    // 2. Se for uma pesquisa por assunto/projeto, executa a BUSCA WEB REAL na internet via DuckDuckGo Open Web API
    if (!searchTerms.startsWith("http://") && !searchTerms.startsWith("https://")) {
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchTerms + " official documentation")}`;
        const searchRes = await safeFetch(searchUrl, {
          timeoutMs: 10000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        if (searchRes.ok) {
          const html = await searchRes.text();
          const uddgMatches = Array.from(html.matchAll(/uddg=([^&"']+)/gi));
          const candidateUrls: string[] = [];

          for (const match of uddgMatches) {
            try {
              const decodedUrl = decodeURIComponent(match[1]);
              if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
                candidateUrls.push(decodedUrl);
              }
            } catch {}
          }

          const uniqueUrls = Array.from(new Set(candidateUrls));
          const scoredCandidates = uniqueUrls
            .map((url) => {
              const auth = this.scoreUrlAuthority(url);
              return { url, score: auth.score, isPrimary: auth.isPrimary };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);

          // Raspa as 2 páginas de maior autoridade encontradas na internet
          const topCandidates = scoredCandidates.slice(0, 2);
          for (const cand of topCandidates) {
            try {
              const pageRes = await safeFetch(cand.url, { timeoutMs: 8000 });
              if (pageRes.ok) {
                const pageHtml = await pageRes.text();
                const sanitizedContent = this.sanitizeDocHtml(pageHtml);
                if (sanitizedContent.length > 50) {
                  results.push({
                    url: cand.url,
                    title: `Documentação Oficial (${new URL(cand.url).hostname})`,
                    authorityScore: cand.score,
                    isPrimarySource: cand.isPrimary,
                    sanitizedContent,
                  });
                }
              }
            } catch (pageErr) {
              console.warn(`[UNIVERSAL_DOCS_FETCHER] Erro ao raspar página ${cand.url}:`, String(pageErr));
            }
          }
        }
      } catch (searchErr) {
        console.warn(`[UNIVERSAL_DOCS_FETCHER] Erro na busca web para "${searchTerms}":`, String(searchErr));
      }
    }

    const aggregatedDocsContext = results.length > 0
      ? results.map((r) => `--- DOCUMENTAÇÃO PRIMÁRIA OBTIDA NA INTERNET: ${r.url} (Score: ${r.authorityScore}) ---\n${r.sanitizedContent}`).join("\n\n")
      : `Pesquisa web executada para "${techQuery}". Utilize especificações oficiais da tecnologia em questão, schemas relacionais ricos no Prisma e tipagem estrita com TypeScript.`;

    return {
      query: techQuery,
      topResults: results,
      aggregatedDocsContext,
    };
  }
}
