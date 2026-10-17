import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  readProjectMemory,
  writeProjectMemory,
  renderProjectMemoryDocument,
  consolidateMemoryFromSpec,
  MAX_MEMORY_LINES,
  MAX_MEMORY_BYTES,
  MEMORY_DIR_NAME,
  MEMORY_FILE_NAME,
} from "@/core/memory/project-memory";
import {
  buildProjectSnapshot,
  formatProjectContext,
} from "@/core/project/project-context";
import { parseSpecDocument } from "@/core/intake/spec-format";

describe("Skill de Memória Persistente de Projeto (Project Memory - L2)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-mem-test-"));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignora erro de limpeza no Windows
    }
  });

  describe("Operações Básicas de Disco e Limites Duros", () => {
    it("deve retornar null se o projeto ou arquivo de memória não existir", () => {
      expect(readProjectMemory(tempDir)).toBeNull();
      expect(readProjectMemory("caminho-inexistente-xyz-123")).toBeNull();
    });

    it("deve criar o diretório .nextcode e gravar MEMORY.md respeitando integridade", () => {
      const conteudo = "# Memória de Teste\n- Linha 1\n- Linha 2\n";
      const gravou = writeProjectMemory(tempDir, conteudo);
      expect(gravou).toBe(true);

      const memPath = path.join(tempDir, MEMORY_DIR_NAME, MEMORY_FILE_NAME);
      expect(fs.existsSync(memPath)).toBe(true);

      const lido = readProjectMemory(tempDir);
      expect(lido).not.toBeNull();
      expect(lido).toContain("# Memória de Teste");
      expect(lido).toContain("- Linha 1");
    });

    it("deve aplicar teto estrito de MAX_MEMORY_LINES (50 linhas)", () => {
      // Gera 120 linhas
      const muitasLinhas = Array.from({ length: 120 }, (_, i) => `- Diretriz importante número ${i + 1}`).join("\n");
      const gravou = writeProjectMemory(tempDir, muitasLinhas);
      expect(gravou).toBe(true);

      const lido = readProjectMemory(tempDir);
      expect(lido).not.toBeNull();

      const totalLinhas = lido!.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      expect(totalLinhas).toBeLessThanOrEqual(MAX_MEMORY_LINES);
      // Deve conter a primeira diretriz mas não a 100ª
      expect(lido).toContain("número 1");
      expect(lido).not.toContain("número 100");
    });

    it("deve aplicar teto estrito de MAX_MEMORY_BYTES (6000 bytes)", () => {
      // Linha gigante com 10.000 caracteres
      const linhaGigante = "- " + "A".repeat(10_000);
      const gravou = writeProjectMemory(tempDir, linhaGigante);
      expect(gravou).toBe(true);

      const lido = readProjectMemory(tempDir);
      expect(lido).not.toBeNull();
      expect(Buffer.byteLength(lido!, "utf8")).toBeLessThanOrEqual(MAX_MEMORY_BYTES + 50);
    });
  });

  describe("Consolidação a partir de Spec Canônica", () => {
    const rawSpecYaml = `---
titulo: "Micro SaaS de Assinaturas"
versao: 1
tipo: "modulo"
stack:
  - "Next.js 14 App Router"
  - "TailwindCSS"
  - "Prisma"
modulos:
  - id: "auth"
    nome: "Autenticação e Sessões"
    resumo: "Login via OAuth e JWT"
    arquivos:
      - "src/app/api/auth/route.ts"
      - "src/lib/auth.ts"
  - id: "billing"
    nome: "Faturamento Stripe"
    resumo: "Checkout e Webhooks"
    arquivos:
      - "src/app/api/webhook/stripe/route.ts"
rotas:
  - caminho: "/dashboard"
    metodo: "GET"
    descricao: "Painel principal do cliente"
  - caminho: "/api/checkout"
    metodo: "POST"
    descricao: "Cria sessão Stripe"
requisitos:
  - id: "REQ-01"
    titulo: "Sessão persistente de 30 dias"
    tipo: "funcional"
    prioridade: "alta"
    criteriosAceite:
      - "Cookie seguro httpOnly"
  - id: "REQ-02"
    titulo: "Webhook idempotente Stripe"
    tipo: "funcional"
    prioridade: "alta"
    criteriosAceite:
      - "Trata eventos duplicados"
arquivosAfetados:
  - "src/app/api/auth/route.ts"
  - "src/lib/auth.ts"
  - "src/app/api/webhook/stripe/route.ts"
---

# Especificação do Micro SaaS
Visão geral do sistema.
`;

    it("deve extrair módulos, rotas e requisitos de uma spec aprovada e consolidar em .nextcode/MEMORY.md", () => {
      const parsedSpec = parseSpecDocument(rawSpecYaml);
      expect(parsedSpec).not.toBeNull();

      const res = consolidateMemoryFromSpec({
        projectPath: tempDir,
        projectName: "SaaS Pro",
        spec: parsedSpec!,
        sessionId: "sess-test-mem-01",
      });

      expect(res.success).toBe(true);
      expect(res.memoryText).toContain("# Memória do Projeto: SaaS Pro");
      expect(res.memoryText).toContain("## 1. Diretrizes e Regras do Fundador");
      expect(res.memoryText).toContain("App Router do Next.js");
      expect(res.memoryText).toContain("## 2. Decisões de Arquitetura e Contratos");
      expect(res.memoryText).toContain("Módulo 'Autenticação e Sessões'");
      expect(res.memoryText).toContain("Módulo 'Faturamento Stripe'");
      expect(res.memoryText).toContain("Rota '/dashboard'");
      expect(res.memoryText).toContain("Requisito REQ-01: Sessão persistente de 30 dias");
      expect(res.memoryText).toContain("## 3. Armadilhas e Lições Aprendidas");

      // Confere se o arquivo em disco foi realmente persistido
      const lidoDoDisco = readProjectMemory(tempDir);
      expect(lidoDoDisco?.trim()).toBe(res.memoryText.trim());
    });
  });

  describe("Injeção Automática no Contexto do Chat (<project_context>)", () => {
    it("M20: com .nextcode/MEMORY.md no disco, o snapshot NÃO lê e o contexto do prompt NÃO inclui a memória", () => {
      // 1. Cria um package.json simulado para o projeto
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "meu-app-saas", version: "1.0.0" }, null, 2),
        "utf8"
      );

      // 2. Grava a memória do projeto
      const docMemoria = renderProjectMemoryDocument({
        projectName: "Meu App SaaS",
        sections: {
          diretrizes: ["Sem libs externas pesadas", "Usar SQLite via Prisma"],
          arquitetura: ["Camada de rotas em src/app/api", "Tabelas User e Session"],
          licoes: ["Nunca mutar estado React diretamente"],
        },
      });
      writeProjectMemory(tempDir, docMemoria);

      // 3. Constrói o snapshot do projeto
      const snapshot = buildProjectSnapshot({
        name: "Meu App SaaS",
        path: tempDir,
        description: "Projeto de teste de memória",
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.memoryContent).toBeUndefined();

      // 4. O contexto que vai no prompt não traz a memória (mudança 20: desligada até o conserto pós-Gate 1)
      const contextPrompt = formatProjectContext(snapshot!);
      expect(contextPrompt).toContain("<project_context>");
      expect(contextPrompt).not.toContain("MEMÓRIA PERSISTENTE DO PROJETO");
      expect(contextPrompt).not.toContain("Sem libs externas pesadas");
      // O arquivo do usuário continua no disco (não é apagado)
      expect(readProjectMemory(tempDir)).toContain("Sem libs externas pesadas");
    });
  });

  describe("Concorrência e Robustez a Falhas (Fail-Open)", () => {
    it("deve suportar múltiplas gravações simultâneas sem corromper o arquivo", async () => {
      const promessas = Array.from({ length: 15 }, (_, i) => {
        return Promise.resolve().then(() => {
          return writeProjectMemory(
            tempDir,
            `# Versão Concorrente ${i}\n- Registro teste ${i}\n`
          );
        });
      });

      const resultados = await Promise.all(promessas);
      expect(resultados.every((r) => r === true)).toBe(true);

      const finalLido = readProjectMemory(tempDir);
      expect(finalLido).not.toBeNull();
      expect(finalLido).toMatch(/# Versão Concorrente \d+/);
    });

    it("deve falhar silenciosamente (fail-open) se o caminho for inválido", () => {
      expect(writeProjectMemory("", "conteudo")).toBe(false);
      expect(writeProjectMemory("/caminho/completamente/invalido/para/o/os", "conteudo")).toBe(false);
    });
  });

  describe("Integração E2E com Aprovação de Spec (approveSpecAndStart)", () => {
    it("M20: aprovar a Spec NÃO grava .nextcode/MEMORY.md", async () => {
      // Importa o prisma e o gatilho de execução
      const prismaModule = await import("@/lib/prisma");
      const prisma = prismaModule.default;
      const { approveSpecAndStart } = await import("@/core/orchestrator/execution-trigger");

      // 1. Cria Projeto apontando para tempDir
      const project = await prisma.project.create({
        data: {
          name: "Projeto E2E Memory",
          path: tempDir,
        },
      });

      // 2. Cria Sessão em fase SPEC_REVISAO
      const session = await prisma.session.create({
        data: {
          projectId: project.id,
          title: "Sessão com Spec",
          phase: "SPEC_REVISAO",
        },
      });

      const validSpec = `---
titulo: ERP de Vendas
status: aprovado
data: 2026-10-12
stack: [Next.js, TypeScript]
modulos:
  - id: mod-vendas
    nome: Modulo de Vendas
    resumo: Pedidos e Faturamento
    arquivos: [src/vendas/pedido.ts]
rotas:
  - caminho: /pedidos
    metodo: GET
    descricao: Listagem de pedidos
requisitos:
  - id: REQ-V1
    titulo: Criar pedido com itens
    tipo: funcional
    prioridade: alta
    criteriosAceite: [Item obrigatorio]
arquivosAfetados:
  - src/vendas/pedido.ts
---

# ERP de Vendas
Descrição completa.`;

      // 3. Executa o gatilho oficial de aprovação
      const resultado = await approveSpecAndStart(session.id, validSpec);
      expect(resultado.ok).toBe(true);

      // 4. Mudança 20: nada é gravado na pasta do projeto
      expect(readProjectMemory(tempDir)).toBeNull();

      // Cleanup do banco
      await prisma.taskNode.deleteMany({ where: { sessionId: session.id } });
      await prisma.job.deleteMany({ where: { sessionId: session.id } });
      await prisma.session.delete({ where: { id: session.id } });
      await prisma.project.delete({ where: { id: project.id } });
    });
  });
});
