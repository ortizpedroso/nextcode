import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import {
  validateContract,
  renderContractTs,
  renderConformance,
  type ContratoProjeto,
  type ContractStageRef,
} from "@/core/orchestrator/project-contract";

describe("A1.1 — Contrato do Projeto e Conferência Mecânica", () => {
  const defaultStages: ContractStageRef[] = [
    {
      id: "mb-1",
      arquivos: ["src/lib/auth.ts", "src/core/session.ts"],
      dependeDe: [],
    },
    {
      id: "mb-2",
      arquivos: ["src/app/api/auth/login/route.ts", "src/services/login.ts"],
      dependeDe: ["mb-1"],
    },
    {
      id: "mb-3",
      arquivos: ["src/app/api/admin/users/route.ts"],
      dependeDe: ["mb-2"],
    },
  ];

  const validContract: ContratoProjeto = {
    entidades: [
      {
        nome: "Sessao",
        campos: [
          { nome: "usuarioId", tipo: "string" },
          { nome: "papel", tipo: "PapelUsuario" },
          { nome: "adminPlataforma", tipo: "boolean" },
          { nome: "expiraEm", tipo: "Date", opcional: true },
        ],
        dono: "mb-1",
      },
    ],
    enums: [
      {
        nome: "PapelUsuario",
        valores: ["DONO", "ADMIN", "OPERADOR"],
        dono: "mb-1",
      },
    ],
    funcoes: [
      {
        nome: "criarSessao",
        arquivo: "src/lib/auth.ts",
        assinatura: "(usuarioId: string, papel: PapelUsuario) => Promise<Sessao>",
        dono: "mb-1",
        usadoPor: ["mb-2"],
      },
    ],
    rotas: [
      {
        metodo: "POST",
        caminho: "/api/auth/login",
        arquivo: "src/app/api/auth/login/route.ts",
        entrada: "{ email: string; pass: string }",
        saida: "{ token: string; sessao: Sessao }",
        erros: [{ status: 401, corpo: '{ erro: "invalido" }' }],
        dono: "mb-2",
        usadoPor: ["mb-3"],
      },
    ],
  };

  // (a) Contrato válido → 0 erros
  it("(a) contrato válido devolve 0 erros", () => {
    const errors = validateContract(validContract, defaultStages);
    expect(errors).toEqual([]);
  });

  // (b) Um teste para cada erro do item 2
  describe("(b) erros mecânicos de validação do contrato", () => {
    it("detecta dono inexistente em entidade, enum, função e rota", () => {
      const invalid: ContratoProjeto = {
        entidades: [{ nome: "E1", campos: [], dono: "mb-fantasma" }],
        enums: [{ nome: "Enum1", valores: ["A"], dono: "mb-fantasma" }],
        funcoes: [
          {
            nome: "fn1",
            arquivo: "src/lib/auth.ts",
            assinatura: "() => void",
            dono: "mb-fantasma",
            usadoPor: [],
          },
        ],
        rotas: [
          {
            metodo: "GET",
            caminho: "/api/test",
            arquivo: "src/app/api/auth/login/route.ts",
            entrada: "void",
            saida: "void",
            erros: [],
            dono: "mb-fantasma",
            usadoPor: [],
          },
        ],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(errors.some((e) => e.includes('[DONO INEXISTENTE] Entidade "E1"'))).toBe(true);
      expect(errors.some((e) => e.includes('[DONO INEXISTENTE] Enum "Enum1"'))).toBe(true);
      expect(errors.some((e) => e.includes('[DONO INEXISTENTE] Função "fn1"'))).toBe(true);
      expect(errors.some((e) => e.includes('[DONO INEXISTENTE] Rota "GET /api/test"'))).toBe(true);
    });

    it("detecta arquivo de função ou rota fora dos arquivos da etapa dona", () => {
      const invalid: ContratoProjeto = {
        entidades: [],
        enums: [],
        funcoes: [
          {
            nome: "fnFora",
            arquivo: "src/outro/arquivo.ts",
            assinatura: "() => void",
            dono: "mb-1",
            usadoPor: [],
          },
        ],
        rotas: [
          {
            metodo: "POST",
            caminho: "/api/auth/login",
            arquivo: "src/app/api/outro/route.ts",
            entrada: "void",
            saida: "void",
            erros: [],
            dono: "mb-2",
            usadoPor: [],
          },
        ],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(
        errors.some((e) => e.includes('[ARQUIVO FORA DO DONO] Função "fnFora"'))
      ).toBe(true);
      expect(
        errors.some((e) => e.includes('[ARQUIVO FORA DO DONO] Rota "POST /api/auth/login"'))
      ).toBe(true);
    });

    it("detecta usadoPor sem dependência (direta ou indireta) da etapa dona", () => {
      // mb-1 não depende de mb-2 nem de mb-3
      const invalid: ContratoProjeto = {
        entidades: [],
        enums: [],
        funcoes: [
          {
            nome: "fnSemDep",
            arquivo: "src/services/login.ts",
            assinatura: "() => void",
            dono: "mb-2",
            usadoPor: ["mb-1"], // mb-1 é upstream de mb-2, não depende de mb-2
          },
        ],
        rotas: [],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(
        errors.some((e) =>
          e.includes(
            '[USADO POR SEM DEPENDENCIA] Etapa "mb-1" usa a função "fnSemDep" da etapa dona "mb-2", mas não depende dela.'
          )
        )
      ).toBe(true);
    });

    it("detecta nome repetido entre entidades, enums ou funções", () => {
      const invalid: ContratoProjeto = {
        entidades: [{ nome: "Duplicado", campos: [], dono: "mb-1" }],
        enums: [{ nome: "Duplicado", valores: ["A"], dono: "mb-1" }],
        funcoes: [
          {
            nome: "fnDuplicada",
            arquivo: "src/lib/auth.ts",
            assinatura: "() => void",
            dono: "mb-1",
            usadoPor: [],
          },
          {
            nome: "fnDuplicada",
            arquivo: "src/lib/auth.ts",
            assinatura: "() => string",
            dono: "mb-1",
            usadoPor: [],
          },
        ],
        rotas: [],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(errors.some((e) => e.includes('[NOME REPETIDO] Enum ou entidade "Duplicado"'))).toBe(true);
      expect(errors.some((e) => e.includes('[NOME REPETIDO] Função "fnDuplicada"'))).toBe(true);
    });

    it("detecta tipo citado que não é entidade, enum, primitivo TS nem global", () => {
      const invalid: ContratoProjeto = {
        entidades: [
          {
            nome: "Perfil",
            campos: [{ nome: "dados", tipo: "TipoInexistenteNaTerra" }],
            dono: "mb-1",
          },
        ],
        enums: [],
        funcoes: [
          {
            nome: "buscar",
            arquivo: "src/lib/auth.ts",
            assinatura: "(id: string) => TipoDesconhecidoRetorno",
            dono: "mb-1",
            usadoPor: [],
          },
        ],
        rotas: [],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(
        errors.some((e) => e.includes('[TIPO DESCONHECIDO] Tipo "TipoInexistenteNaTerra"'))
      ).toBe(true);
      expect(
        errors.some((e) => e.includes('[TIPO DESCONHECIDO] Tipo "TipoDesconhecidoRetorno"'))
      ).toBe(true);
    });

    it("detecta rota cujo arquivo não é route.ts", () => {
      const invalid: ContratoProjeto = {
        entidades: [],
        enums: [],
        funcoes: [],
        rotas: [
          {
            metodo: "POST",
            caminho: "/api/login",
            arquivo: "src/services/login.ts", // não é route.ts
            entrada: "void",
            saida: "void",
            erros: [],
            dono: "mb-2",
            usadoPor: [],
          },
        ],
      };
      const errors = validateContract(invalid, defaultStages);
      expect(
        errors.some((e) =>
          e.includes(
            '[ROTA INVALIDA] Arquivo da rota "POST /api/login" é "src/services/login.ts"; rotas devem estar em "route.ts".'
          )
        )
      ).toBe(true);
    });
  });

  // (c) renderContractTs compila em memória com createProgram
  it("(c) renderContractTs compila sozinho em memória usando createProgram", () => {
    const code = renderContractTs(validContract);
    expect(code).toContain('export type PapelUsuario = "DONO" | "ADMIN" | "OPERADOR";');
    expect(code).toContain("export interface Sessao {");
    expect(code).toContain("export type FnCriarSessao = (usuarioId: string, papel: PapelUsuario) => Promise<Sessao>;");

    const host = ts.createCompilerHost({
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    });

    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (fileName === "contract.ts") {
        return ts.createSourceFile(fileName, code, languageVersion);
      }
      return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    };

    const program = ts.createProgram(["contract.ts"], {
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    }, host);

    const diagnostics = ts.getPreEmitDiagnostics(program);
    // Não pode haver diagnósticos de erro no arquivo contract.ts
    const contractErrors = diagnostics.filter(
      (d) => d.file && d.file.fileName === "contract.ts"
    );
    expect(contractErrors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });

  // (d) Controle do Gateway: projeto mínimo em os.tmpdir()
  // PapelUsuario = "DONO" | "ADMIN" | "OPERADOR"
  // Sessao { usuarioId, papel: PapelUsuario, adminPlataforma: boolean }
  // criarSessao(usuarioId: string, papel: PapelUsuario) => Promise<Sessao>
  // Com código defeituoso (sessao.papel === "admin" e criarSessao(usuario.id) sem papel), tsc REPROVA.
  // Com código corrigido, tsc PASSA.
  it("(d) controle do Gateway: tsc reprova o defeito real e passa quando corrigido", () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "nc-a1-gateway-control-"));
    try {
      const srcDir = path.join(tmpProject, "src");
      const contractsDir = path.join(srcDir, "contracts");
      const libDir = path.join(srcDir, "lib");
      const confDir = path.join(contractsDir, "conformidade");
      fs.mkdirSync(contractsDir, { recursive: true });
      fs.mkdirSync(libDir, { recursive: true });
      fs.mkdirSync(confDir, { recursive: true });

      // tsconfig com alias @/* -> src/*
      fs.writeFileSync(
        path.join(tmpProject, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "esnext",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            baseUrl: ".",
            paths: { "@/*": ["src/*"] },
          },
          include: ["src/**/*.ts"],
        }),
        "utf8"
      );

      const gatewayContract: ContratoProjeto = {
        entidades: [
          {
            nome: "Sessao",
            campos: [
              { nome: "usuarioId", tipo: "string" },
              { nome: "papel", tipo: "PapelUsuario" },
              { nome: "adminPlataforma", tipo: "boolean" },
            ],
            dono: "mb-1",
          },
        ],
        enums: [
          {
            nome: "PapelUsuario",
            valores: ["DONO", "ADMIN", "OPERADOR"],
            dono: "mb-1",
          },
        ],
        funcoes: [
          {
            nome: "criarSessao",
            arquivo: "src/lib/auth.ts",
            assinatura: "(usuarioId: string, papel: PapelUsuario) => Promise<Sessao>",
            dono: "mb-1",
            usadoPor: ["mb-2"],
          },
        ],
        rotas: [],
      };

      // 1. Grava src/contracts/index.ts e conformidade
      const contractTs = renderContractTs(gatewayContract);
      fs.writeFileSync(path.join(contractsDir, "index.ts"), contractTs, "utf8");

      const confTsMb1 = renderConformance(gatewayContract, "mb-1");
      fs.writeFileSync(path.join(confDir, "mb-1.ts"), confTsMb1, "utf8");

      // 2. Escreve código com os dois defeitos do Gateway:
      // (1) criarSessao(usuario.id) sem papel em src/app/api/auth/login/route.ts
      // (2) sessao.papel === "admin" (minúsculo em vez de "ADMIN") em src/lib/auth.ts
      const buggyAuthCode = `
import type { Sessao, PapelUsuario } from "@/contracts";

export async function criarSessao(usuarioId: string, papel: PapelUsuario): Promise<Sessao> {
  const sessao: Sessao = { usuarioId, papel, adminPlataforma: false };
  if (sessao.papel === "admin") {
    // defeito 2: comparação com valor inexistente no enum
  }
  return sessao;
}
`;
      fs.writeFileSync(path.join(libDir, "auth.ts"), buggyAuthCode, "utf8");

      // Consumidor chamando criarSessao(usuario.id) sem o 2º parâmetro exigido
      const apiDir = path.join(srcDir, "app", "api", "auth", "login");
      fs.mkdirSync(apiDir, { recursive: true });
      const buggyLoginRoute = `
import { criarSessao } from "@/lib/auth";

export async function POST(req: Request) {
  const usuario = { id: "u-123" };
  // defeito 1: chamada sem o segundo parâmetro "papel" exigido no contrato
  const sessao = await criarSessao(usuario.id);
  return Response.json(sessao);
}
`;
      fs.writeFileSync(path.join(apiDir, "route.ts"), buggyLoginRoute, "utf8");

      // Função auxiliar para compilar o projeto em tmpProject
      const runTscCheck = () => {
        const configFile = ts.readConfigFile(path.join(tmpProject, "tsconfig.json"), ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          tmpProject
        );
        const program = ts.createProgram(parsed.fileNames, parsed.options);
        return ts.getPreEmitDiagnostics(program);
      };

      // Teste com defeito: tsc TEM DE REPROVAR
      const buggyDiagnostics = runTscCheck();
      expect(buggyDiagnostics.length).toBeGreaterThan(0);

      const messages = buggyDiagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n")
      );
      // Confere que aponta o erro de tipos/assinatura do contrato e do enum
      const hasEnumMismatch = messages.some(
        (m) =>
          m.includes('"admin"') ||
          m.includes('Type \'"admin"\'') ||
          m.includes("This comparison appears to be unintentional")
      );
      const hasSignatureMismatch = messages.some(
        (m) =>
          m.includes("Expected 2 arguments, but got 1") ||
          m.includes("arguments, but got 1")
      );

      expect(hasEnumMismatch).toBe(true);
      expect(hasSignatureMismatch).toBe(true);

      // 3. Escreve código CORRIGIDO:
      // (1) criarSessao com (usuarioId: string, papel: PapelUsuario)
      // (2) sessao.papel === "ADMIN"
      // (3) chamada em route.ts com criarSessao(usuario.id, "ADMIN")
      const fixedAuthCode = `
import type { Sessao, PapelUsuario } from "@/contracts";

export async function criarSessao(usuarioId: string, papel: PapelUsuario): Promise<Sessao> {
  const sessao: Sessao = { usuarioId, papel, adminPlataforma: papel === "ADMIN" };
  if (sessao.papel === "ADMIN") {
    // correto
  }
  return sessao;
}
`;
      fs.writeFileSync(path.join(libDir, "auth.ts"), fixedAuthCode, "utf8");

      const fixedLoginRoute = `
import { criarSessao } from "@/lib/auth";

export async function POST(req: Request) {
  const usuario = { id: "u-123" };
  const sessao = await criarSessao(usuario.id, "ADMIN");
  return Response.json(sessao);
}
`;
      fs.writeFileSync(path.join(apiDir, "route.ts"), fixedLoginRoute, "utf8");

      const fixedDiagnostics = runTscCheck();
      const fixedErrors = fixedDiagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n")
      );
      expect(fixedErrors).toEqual([]);
    } finally {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
