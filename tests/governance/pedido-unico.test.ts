import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const inMemoryDb = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  const taskNodes = new Map<string, any>();
  const messages: any[] = [];
  let idSeq = 1;

  const nextId = (prefix: string) => `${prefix}-${idSeq++}`;

  const reset = () => {
    sessions.clear();
    taskNodes.clear();
    messages.splice(0, messages.length);
    idSeq = 1;
  };

  const prismaMock: any = {
    session: {
      create: vi.fn(async ({ data }: any) => {
        const id = data.id || nextId("sess");
        const rec = {
          id,
          projectId: data.projectId ?? "proj-1",
          status: data.status ?? "EXECUTANDO",
          canonicalSpec: data.canonicalSpec ?? null,
          project: data.project ?? { id: "proj-1", name: "ProjetoTeste", path: data.executionDirectory ?? null },
          ...data,
        };
        sessions.set(id, rec);
        return { ...rec };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sessions.get(where.id);
        return s ? { ...s } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = sessions.get(where.id);
        if (!s) throw new Error(`Session ${where.id} not found`);
        const updated = { ...s, ...data };
        sessions.set(where.id, updated);
        return { ...updated };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, s] of sessions.entries()) {
          if (where?.id && s.id !== where.id) continue;
          if (where?.phase !== undefined && s.phase !== where.phase) continue;
          if (
            where &&
            Object.prototype.hasOwnProperty.call(where, "phaseContext") &&
            (s.phaseContext ?? null) !== (where.phaseContext ?? null)
          ) {
            continue;
          }
          if (where?.specApproved !== undefined && s.specApproved !== where.specApproved) continue;
          sessions.set(id, { ...s, ...data });
          count++;
        }
        return { count };
      }),
    },
    job: {
      create: vi.fn(async ({ data }: any) => ({ id: nextId("job"), status: "queued", ...data })),
      findUnique: vi.fn(async () => null),
    },
    taskNode: {
      create: vi.fn(async ({ data }: any) => {
        const id = data.id || nextId("node");
        const rec = {
          id,
          sessionId: data.sessionId,
          title: data.title ?? "Etapa",
          role: data.role ?? "executor-backend",
          cluster: data.cluster ?? "backend",
          status: data.status ?? "pending",
          attempts: data.attempts ?? 0,
          maxAttempts: data.maxAttempts ?? 3,
          orderIndex: data.orderIndex ?? 1,
          dependencies: data.dependencies ?? "[]",
          filesScope: data.filesScope ?? "[]",
          payload: data.payload ?? null,
          result: data.result ?? null,
          failureHistory: data.failureHistory ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        taskNodes.set(id, rec);
        return { ...rec };
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const n = taskNodes.get(where.id);
        if (!n) return null;
        const copy = { ...n };
        if (include?.session) {
          const s = sessions.get(n.sessionId) ?? { id: n.sessionId, canonicalSpec: null, project: null };
          copy.session = { ...s };
        }
        return copy;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const n = taskNodes.get(where.id);
        if (!n) throw new Error(`TaskNode ${where.id} not found`);
        return { ...n };
      }),
      findMany: vi.fn(async ({ where }: any = {}) => {
        let list = Array.from(taskNodes.values()).map((n) => ({ ...n }));
        if (where?.sessionId) {
          list = list.filter((n) => n.sessionId === where.sessionId);
        }
        if (where?.id?.in) {
          const set = new Set(where.id.in);
          list = list.filter((n) => set.has(n.id));
        }
        if (where?.specVersion !== undefined) {
          list = list.filter((n) => (n.specVersion ?? 1) === where.specVersion);
        }
        return list;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const n = taskNodes.get(where.id);
        if (!n) throw new Error(`TaskNode ${where.id} not found`);
        const updated = { ...n, ...data, updatedAt: new Date() };
        taskNodes.set(where.id, updated);
        return { ...updated };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, n] of taskNodes.entries()) {
          if (where?.id && typeof where.id === "string" && n.id !== where.id) continue;
          if (where?.id?.in && !where.id.in.includes(n.id)) continue;
          if (where?.sessionId && n.sessionId !== where.sessionId) continue;
          if (where?.status?.in && !where.status.in.includes(n.status)) continue;
          if (typeof where?.status === "string" && n.status !== where.status) continue;
          taskNodes.set(id, { ...n, ...data, updatedAt: new Date() });
          count++;
        }
        return { count };
      }),
    },
    message: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async ({ where }: any = {}) => {
        const filtered = messages.filter((m) => {
          if (where?.sessionId && m.sessionId !== where.sessionId) return false;
          if (where?.role && m.role !== where.role) return false;
          if (where?.content?.contains && !String(m.content).includes(where.content.contains)) return false;
          return true;
        });
        return filtered[0] ?? null;
      }),
      findMany: vi.fn(async ({ where }: any = {}) => {
        return messages.filter((m) => (!where?.sessionId ? true : m.sessionId === where.sessionId));
      }),
      create: vi.fn(async ({ data }: any) => {
        const msg = { id: nextId("msg"), createdAt: new Date(), ...data };
        messages.push(msg);
        return msg;
      }),
    },
    setting: {
      findUnique: vi.fn(async () => null),
    },
    telemetryLog: {
      create: vi.fn(async ({ data }: any) => ({ id: nextId("tel"), ...data })),
    },
    telemetryEvent: {
      create: vi.fn(async ({ data }: any) => ({ id: nextId("tel"), ...data })),
    },
  };

  return { prismaMock, reset, sessions, taskNodes, messages };
});

const hoisted = vi.hoisted(() => ({
  generateAcceptanceTestsMock: vi.fn(),
  dispatchWithFallbackMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: inMemoryDb.prismaMock,
  prisma: inMemoryDb.prismaMock,
}));

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

vi.mock("@/core/governance/acceptance-tests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/governance/acceptance-tests")>();
  return {
    ...actual,
    generateAcceptanceTests: hoisted.generateAcceptanceTestsMock,
  };
});

vi.mock("@/core/llm/smart-router", () => ({
  SmartRouter: class {
    dispatchWithFallback = hoisted.dispatchWithFallbackMock;
  },
}));

import { loadRoleSkill } from "@/core/skills/skill-runtime";
import { ownTestLoadFailure, type AcceptanceTest } from "@/core/governance/acceptance-tests";
import { DualLensAuditor, type ValidationType2Result } from "@/core/governance/dual-lens-auditor";
import { IncidentReporter } from "@/core/governance/incident-reporter";
import {
  executeTaskNode,
  cascadeBlockedNodes,
  setPedidoUnicoSkillsRootForTests,
} from "@/core/orchestrator/node-executor";
import {
  retryNodeAndCascade,
  canRetryExhaustedCodeOnResume,
  blockedTaskReleaseKind,
  aplicarEscolhaHumanaPedidoUnico,
} from "@/core/orchestrator/session-resume";
import {
  verificarPedidoUnico,
  carregarSkillPedidoUnico,
  PROVA_CARREGA_CHECK,
  lerEstadoPedidoUnico,
  registrarEscolhaPedidoUnico,
  alargarContratoDaSessaoAposEscolha,
  alargarTextoContratoComCampos,
  marcarEscolhaPedidoUnicoNoPainel,
  filtrarMicrobriefPorValeContrato,
  filtrarFalhasAceitePorValeContrato,
  filtrarAuditoriaPorValeContrato,
  aplicarReguaMesmaLacuna,
  trechoCitadoMudouNoCodigoNovo,
  construirAvisoLacunaPermanente,
  etapaBloqueadaPorPedidoUnicoSemResolucao,
  reconciliarPedidoUnicoObsoletoNoRegistro,
  persistirReconciliacaoPedidoUnicoObsoleto,
  registroPossuiMarcaPedidoUnicoObsoleta,
} from "@/core/governance/pedido-unico";
import { painelCoerenteComPorteiroPedidoUnico } from "../helpers/pedido-unico-parity";
import { NextRequest } from "next/server";
import { POST as postDag } from "@/app/api/dag/route";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";
import { pedidoUnicoAguardandoEscolha, pedidoUnicoEscolhaGravadaAindaAberta } from "@/lib/pedido-unico-ui";

function criarMicrobriefExemplo(overrides: Partial<MicrobriefAndReportDocument> = {}): MicrobriefAndReportDocument {
  return {
    documento: "microbrief",
    idMicrobrief: "MB-006",
    idMacrobrief: "MACRO-001",
    idProjeto: "proj-1",
    cluster: "backend",
    nivelModeloSugerido: "medio",
    dependeDe: [],
    arquivosPermitidos: {
      criar: ["src/billing/emitir.ts"],
      modificar: [],
      lerContratos: [],
    },
    statusExecucao: "PENDENTE",
    tentativaAtual: 0,
    medidoPeloHarness: {
      compilou: null,
      testes: null,
      arquivosAlterados: [],
    },
    reqsCobertos: ["REQ-006"],
    criteriosAceitePorReq: {
      "REQ-006": [
        "Ao emitir cobrança, deve retornar o id da cobrança, o QR Pix, o copia-e-cola e a linha digitável.",
      ],
    },
    interfacesProduz: "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>",
    interfacesConsome: [],
    registroCumprimento: [],
    ...overrides,
  };
}

describe("Skill pedido-unico e contrato de carregamento", () => {
  afterEach(() => {
    setPedidoUnicoSkillsRootForTests(null);
  });

  it("carrega skills/pedido-unico/SKILL.md com papel conferente, escrever nunca, ferramentas vazias e 3 checagens", () => {
    const loaded = carregarSkillPedidoUnico();
    expect(loaded.name).toBe("pedido-unico");
    expect(loaded.papel).toBe("conferente");
    expect(loaded.permissoes.escrever).toBe("nunca");
    expect(loaded.ferramentas).toEqual([]);
    expect(loaded.checagens).toEqual([
      "retorno_do_contrato_e_criterio",
      "lacuna_anterior_permanece",
      "prova_carrega",
    ]);
    expect(PROVA_CARREGA_CHECK).toBe(ownTestLoadFailure);

    const viaRuntime = loadRoleSkill("pedido-unico");
    expect(viaRuntime.papel).toBe("conferente");
    expect(viaRuntime.bodyMarkdown).toContain("Um pedido só");
    expect(viaRuntime.bodyMarkdown).toContain("ownTestLoadFailure");
  });
});

describe("Fatia 1 — Função pura verificarPedidoUnico (antes do executor, sem modelo)", () => {
  it("falha fechado quando o contrato retorna { id: string } e o critério pede QR Pix, copia-e-cola ou linha digitável", () => {
    expect(typeof verificarPedidoUnico).toBe("function");

    const contrato = "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>";
    const criterios = {
      "REQ-001": [
        "Ao emitir cobrança, deve retornar o id da cobrança, o QR Pix, o código copia-e-cola e a linha digitável do boleto.",
      ],
    };

    const res = verificarPedidoUnico(contrato, criterios);

    expect(res.coerente).toBe(false);
    expect(res.status).toBe("conflito");
    expect(res.camposRetornoContrato).toEqual(["id"]);
    expect(res.camposFaltantes).toEqual(
      expect.arrayContaining(["QR Pix", "copia-e-cola", "linha digitável"]),
    );
    expect(res.conflito).not.toBeNull();
    expect(res.conflito?.opcoes).toEqual(["vale o contrato", "vale o critério"]);
  });

  it("falha fechado individualmente para QR Pix, para copia-e-cola e para linha digitável quando retorno é { id: string }", () => {
    const contrato = "emitir(dados: Dados): { id: string }";

    const rQr = verificarPedidoUnico(contrato, ["Deve devolver QR Pix para pagamento imediato."]);
    expect(rQr.coerente).toBe(false);
    expect(rQr.status).toBe("conflito");
    expect(rQr.camposFaltantes).toContain("QR Pix");

    const rCopia = verificarPedidoUnico(contrato, ["Deve incluir copia-e-cola na resposta da emissão."]);
    expect(rCopia.coerente).toBe(false);
    expect(rCopia.status).toBe("conflito");
    expect(rCopia.camposFaltantes).toContain("copia-e-cola");

    const rLinha = verificarPedidoUnico(contrato, ["Deve retornar a linha digitável do boleto gerado."]);
    expect(rLinha.coerente).toBe(false);
    expect(rLinha.status).toBe("conflito");
    expect(rLinha.camposFaltantes).toContain("linha digitável");
  });

  it("passa (coerente) quando contrato e critério nomeiam os mesmos campos", () => {
    const contrato =
      "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string; qrPix: string; copiaECola: string; linhaDigitavel: string }>";
    const criterios = {
      "REQ-001": ["Ao emitir cobrança, retornar id, QR Pix, copia-e-cola e linha digitável."],
    };

    const res = verificarPedidoUnico(contrato, criterios);

    expect(res.coerente).toBe(true);
    expect(res.status).toBe("coerente");
    expect(res.camposFaltantes).toEqual([]);
    expect(res.conflito).toBeNull();
  });

  it("passa (coerente) quando o critério não pede campo fora do retorno", () => {
    const contrato = "export function criarCobranca(valor: number): Promise<{ id: string }>";
    const criterios = {
      "REQ-002": ["Deve validar valor positivo e retornar o id da cobrança criada."],
    };

    const res = verificarPedidoUnico(contrato, criterios);

    expect(res.coerente).toBe(true);
    expect(res.status).toBe("coerente");
    expect(res.camposFaltantes).toEqual([]);
  });

  it("isola a função conflitante em etapa com múltiplas funções (FnCriarCobrancaParaLojista + FnObterIndicadores) e alarga só o retorno dela", () => {
    const interfacesProduz = [
      "export type FnCriarCobrancaParaLojista = (dados: { lojistaId: string; clienteId?: string; valor: number; vencimento: string; formaPagamento: string; emitirNotaFiscal?: boolean }) => Promise<{ id: string }>;",
      "export type FnObterIndicadores = (lojistaId: string, de: string, ate: string) => Promise<{ recebido: number; pendente: number; inadimplente: number; estornado: number; taxas: { retidas: number; repassadas: number }; valorLiquido: number; evolucaoReceita: Array<{ data: string; valor: number }>; distribuicaoMeios: Array<{ meio: string; percentual: number }> }>;",
    ];
    const criterios = [
      {
        reqId: "REQ-027",
        criterios: [
          "Geração de cobrança (criarCobrancaParaLojista) processa a operação com sucesso.",
          "Para pagamento via Pix ou Boleto, o retorno inclui dados para pagamento (QR Pix ou linha digitável).",
        ],
      },
      {
        reqId: "REQ-050",
        criterios: [
          "Relatórios financeiros (obterIndicadores) retornam totais consolidados no período (recebido, pendente, inadimplente, estornado, taxas, valorLiquido).",
        ],
      },
    ];

    const res = verificarPedidoUnico(interfacesProduz, criterios, {
      tituloEtapa: "Etapa 9/33: lib/cobrancas-service.ts, lib/relatorios.ts",
    });

    expect(res.coerente).toBe(false);
    expect(res.camposRetornoContrato).toEqual(["id"]);
    expect(res.camposFaltantes).toEqual(["QR Pix", "linha digitável"]);
    expect(res.mensagemDecisao).toContain("`{ id: ... }`");
    expect(res.mensagemDecisao).not.toContain("inadimplente");

    const alargado = alargarTextoContratoComCampos(interfacesProduz, res.camposSugeridosParaContrato, {
      criteriosEmConflito: res.criteriosEmConflito,
    });
    expect(alargado).toContain("Promise<{ id: string; qrPix: string; linhaDigitavel: string }>;");
    expect(alargado).not.toContain("qrPix?");
    expect(alargado).not.toContain("VENCIDA");
    const linhaIndicadores = alargado.split("\n").find((linha) => linha.includes("FnObterIndicadores"));
    expect(linhaIndicadores).not.toContain("qrPix");
    expect(alargado).toContain("taxas: { retidas: number; repassadas: number }; valorLiquido: number;");

    const posVerificacao = verificarPedidoUnico(alargado, criterios);
    expect(posVerificacao.coerente).toBe(true);
  });

  it("não lê status entre parênteses como campo e não aceita propriedade opcional como pedido cumprido", () => {
    const contrato = [
      "export type FnCriarCobrancaParaLojista = (dados: { lojistaId: string }) => Promise<{ id: string; qrPix?: string; linhaDigitavel?: string; VENCIDA?: unknown }>;",
      "export type FnObterIndicadores = (lojistaId: string, de: string, ate: string) => Promise<{ recebido: number; pendente: number; inadimplente: number; qrPix?: string; linhaDigitavel?: string; VENCIDA?: unknown }>;",
    ];
    const criterios = {
      "REQ-027": [
        "src/lib/cobrancas-service.ts exporta criarCobrancaParaLojista e devolve os dados de pagamento (QR Pix, linha digitável ou resultado do cartão).",
      ],
      "REQ-050": [
        "src/lib/relatorios.ts exporta obterIndicadores e devolve inadimplente (VENCIDA), recebido e pendente.",
      ],
    };

    const res = verificarPedidoUnico(contrato, criterios);
    expect(res.coerente).toBe(false);
    expect(res.camposFaltantes).toEqual(["QR Pix", "linha digitável"]);
    expect(res.camposSugeridosParaContrato.map((c) => c.propriedade)).not.toContain("VENCIDA");

    const alargado = alargarTextoContratoComCampos(contrato, res.camposSugeridosParaContrato, {
      criteriosEmConflito: res.criteriosEmConflito,
    });
    const cobranca = alargado.split("\n").find((linha) => linha.includes("FnCriarCobrancaParaLojista")) ?? "";
    const indicadores = alargado.split("\n").find((linha) => linha.includes("FnObterIndicadores")) ?? "";
    expect(cobranca).toContain("qrPix: string");
    expect(cobranca).toContain("linhaDigitavel: string");
    expect(cobranca).not.toContain("qrPix?");
    expect(cobranca).not.toContain("VENCIDA");
    expect(indicadores).not.toContain("qrPix");
    expect(indicadores).not.toContain("linhaDigitavel");
    expect(indicadores).not.toContain("VENCIDA");
    expect(verificarPedidoUnico(alargado, criterios).coerente).toBe(true);
  });

  it("não pede a escolha de novo quando o payload já está resolvido e o servidor não reabre", () => {
    const result = JSON.stringify({ pedidoUnicoAguardandoDecisao: true, erro: "CONFLITO_PEDIDO_UNICO" });
    const resolvido = JSON.stringify({
      pedidoUnico: { status: "resolvido", decisao: "vale o critério", decisaoNormalizada: "vale_criterio" },
    });
    expect(pedidoUnicoAguardandoEscolha(result, resolvido)).toBe(false);
    expect(pedidoUnicoAguardandoEscolha(result, resolvido, false)).toBe(false);
    expect(pedidoUnicoAguardandoEscolha(result, resolvido, true)).toBe(true);
    expect(pedidoUnicoEscolhaGravadaAindaAberta(resolvido, true)).toBe(true);
    expect(pedidoUnicoAguardandoEscolha(result, JSON.stringify({ pedidoUnico: { status: "conflito" } }))).toBe(true);
    expect(pedidoUnicoAguardandoEscolha(JSON.stringify({ erro: "SKILL_PEDIDO_UNICO_INVALIDA", pedidoUnicoAguardandoDecisao: true }), undefined, true)).toBe(false);
  });

  it("parêntese no tipo, frase seguinte e grupo opcional não são campo faltante do retorno", () => {
    const saida = verificarPedidoUnico(
      "export type ItemSaida = { titulo: string; modos: ('A' | 'B')[]; precos: { forma: string; parcelas: number }[] };",
      ["GET devolve 200 {titulo, precos[{forma, parcelas}]}."]
    );
    expect(saida.coerente).toBe(true);

    const corpo = verificarPedidoUnico(
      "export type CronSaida = { enviados: number; falhas: number };",
      ["GET devolve 200 com o registro. PUT {nomeMarca, logoUrl} devolve 200."]
    );
    expect(corpo.camposFaltantes).not.toContain("nomeMarca");
    expect(corpo.coerente).toBe(true);

    const opcional = verificarPedidoUnico(
      "export type PagamentoSaida = { id: string; pix?: { qrCodeBase64: string; copiaECola: string }; boleto?: { linhaDigitavel: string } };",
      ["POST devolve 201 {id, pix{qrCodeBase64, copiaECola}?, boleto{linhaDigitavel}?}"]
    );
    expect(opcional.coerente).toBe(true);
  });

  it("conceito conhecido só na cláusula de retorno, não na frase seguinte", () => {
    const qr = verificarPedidoUnico("export type Saida = { id: string };", [
      "GET devolve 200 {id}. O QR Pix fica na etapa seguinte.",
    ]);
    expect(qr.coerente).toBe(true);
    expect(qr.camposFaltantes).not.toContain("QR Pix");

    const comQr = verificarPedidoUnico("export type Saida = { id: string };", [
      "GET devolve 200 {id, qrPix}.",
    ]);
    expect(comQr.coerente).toBe(false);
  });

  it("vale o contrato filtra falha de aceite pelo texto da falha, não pelo arquivo do teste", () => {
    const { contar } = filtrarFalhasAceitePorValeContrato(
      [{ file: "x.test.ts", txt: "AssertionError: esperado id" }],
      [{ caminho: "x.test.ts", conteudo: "// assert qrPix ausente\nexpect(x).qrPix" }],
      ["QR Pix"]
    );
    expect(contar).toHaveLength(1);
  });

  it("genérico aninhado e chamada entre parênteses não viram campo", () => {
    const gen = verificarPedidoUnico("export type Saida = { id: string; meta: string };", [
      "POST devolve 201 { id: string, meta: Foo<Bar, Baz> }.",
    ]);
    expect(gen.camposFaltantes).not.toContain("Baz");
    expect(gen.coerente).toBe(true);

    const call = verificarPedidoUnico("export type Saida = { id: string };", ["retornar rotulo(a, b)."]);
    expect(call.camposFaltantes).not.toContain("a");
  });

  it("corpo de erro 4xx e glosa entre parênteses não são campo do retorno de sucesso", () => {
    const erro = verificarPedidoUnico(
      "export type ItemSaida = { id: string; link: string };",
      ["POST devolve 201 {id, link}. Corpo inválido devolve 422 {erros[{campo, mensagem}]}."]
    );
    expect(erro.camposFaltantes).not.toContain("mensagem");
    expect(erro.camposFaltantes).not.toContain("campo");
    expect(erro.coerente).toBe(true);

    const glosa = verificarPedidoUnico(
      "export type PainelSaida = { totalCentavos: number; porMes: { mes: string; valor: number }[]; ativos: number };",
      ["GET devolve 200 {totalCentavos (soma das pagas, sem as canceladas), porMes[], ativos}."]
    );
    expect(glosa.camposFaltantes).not.toContain("sem");
    expect(glosa.coerente).toBe(true);

    const sucesso = verificarPedidoUnico(
      "export type ItemSaida = { titulo: string };",
      ["GET devolve 200 {titulo, aviso}."]
    );
    expect(sucesso.camposFaltantes).toContain("aviso");
    expect(sucesso.coerente).toBe(false);
  });

  it("lista só de critérios em conflito não limpa o bloqueio sem snapshot completo", () => {
    const payload = JSON.stringify({
      microbrief: { interfacesProduz: "export type ItemSaida = { titulo: string };" },
      pedidoUnico: {
        status: "conflito",
        camposFaltantes: ["aviso"],
        criteriosEmConflito: ["GET devolve 200 {titulo, aviso}."],
        decisaoNormalizada: null,
      },
    });
    expect(
      etapaBloqueadaPorPedidoUnicoSemResolucao({
        payload,
        result: JSON.stringify({ pedidoUnicoAguardandoDecisao: true }),
      })
    ).toBe(true);
  });

  it("conflito obsoleto some quando o snapshot original do registro fecha com o contrato", () => {
    const interfacesProduz =
      "export type ItemSaida = { titulo: string; modos: ('A' | 'B')[]; precos: { forma: string; parcelas: number }[] };";
    const payload = JSON.stringify({
      microbrief: { interfacesProduz },
      pedidoUnico: {
        status: "conflito",
        camposFaltantes: ["titulo"],
        criteriosEmConflito: ["GET devolve 200 {titulo, precos[{forma, parcelas}]}."],
        criteriosOriginaisNoRegistro: {
          "REQ-1": ["GET devolve 200 {titulo, precos[{forma, parcelas}]}."],
        },
        decisaoNormalizada: null,
      },
    });
    expect(
      etapaBloqueadaPorPedidoUnicoSemResolucao({
        payload,
        result: JSON.stringify({ erro: "CONFLITO_PEDIDO_UNICO", pedidoUnicoAguardandoDecisao: true }),
      })
    ).toBe(false);
  });

  it("conflito gravado some quando a leitura atual do contrato fecha", () => {
    const interfacesProduz =
      "export type ItemSaida = { titulo: string; modos: ('A' | 'B')[]; precos: { forma: string; parcelas: number }[] };";
    const payload = JSON.stringify({
      microbrief: {
        interfacesProduz,
        criteriosAceitePorReq: { "REQ-1": ["GET devolve 200 {titulo, precos[{forma, parcelas}]}."] },
      },
      pedidoUnico: { status: "conflito", camposFaltantes: ["titulo"], decisaoNormalizada: null },
    });
    expect(
      etapaBloqueadaPorPedidoUnicoSemResolucao({
        payload,
        result: JSON.stringify({ erro: "CONFLITO_PEDIDO_UNICO", pedidoUnicoAguardandoDecisao: true }),
      })
    ).toBe(false);
    expect(
      pedidoUnicoAguardandoEscolha(
        JSON.stringify({ pedidoUnicoAguardandoDecisao: true }),
        payload,
        false
      )
    ).toBe(false);
  });

  it("skill inválida não trava o Re-tentar nem finge escolha aberta", () => {
    const task = {
      result: JSON.stringify({
        erro: "SKILL_PEDIDO_UNICO_INVALIDA",
        pedidoUnicoAguardandoDecisao: true,
      }),
    };
    expect(etapaBloqueadaPorPedidoUnicoSemResolucao(task)).toBe(false);
    expect(pedidoUnicoAguardandoEscolha(task.result, undefined, true)).toBe(false);
  });
});

describe("Fatia 1 — Porteiro antes de generateAcceptanceTests e antes do executor", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemoryDb.reset();
    setPedidoUnicoSkillsRootForTests(null);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-pedido-unico-"));
  });

  afterEach(() => {
    setPedidoUnicoSkillsRootForTests(null);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it("em conflito: não chama generateAcceptanceTests nem executor, não gasta tentativa, não cascateia etapas 12 e 19, grava conflito e publica decisão única", async () => {
    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-conflito",
        executionDirectory: tempDir,
        canonicalSpec: "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>",
      },
    });

    const microbriefConflitante = criarMicrobriefExemplo();

    const node6 = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-6",
        sessionId: session.id,
        title: "Etapa 6 - Emissão de cobrança",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 0,
        orderIndex: 6,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/billing/emitir.ts"]),
        payload: JSON.stringify({
          etapaId: "etapa-6",
          microbrief: microbriefConflitante,
        }),
      },
    });

    const node12 = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-12",
        sessionId: session.id,
        title: "Etapa 12 - Webhook de cobrança",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 0,
        orderIndex: 12,
        dependencies: JSON.stringify([node6.id]),
        filesScope: JSON.stringify(["src/billing/webhook.ts"]),
      },
    });

    const node19 = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-19",
        sessionId: session.id,
        title: "Etapa 19 - Painel de cobrança",
        role: "executor-frontend",
        cluster: "frontend",
        status: "pending",
        attempts: 0,
        orderIndex: 19,
        dependencies: JSON.stringify([node12.id]),
        filesScope: JSON.stringify(["src/ui/painel.tsx"]),
      },
    });

    const node6WithSession = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: node6.id },
      include: { session: true },
    });

    const result = await executeTaskNode(node6WithSession);

    // 1. Não chamou generateAcceptanceTests nem o laço do executor
    expect(hoisted.generateAcceptanceTestsMock).not.toHaveBeenCalled();
    expect(hoisted.dispatchWithFallbackMock).not.toHaveBeenCalled();
    expect(result.finalStatus).toBe("blocked");

    // 2. Não gastou tentativa e gravou o conflito na etapa
    const updatedNode6 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node6.id } });
    expect(updatedNode6.attempts).toBe(0);
    expect(updatedNode6.status).toBe("blocked");
    const estado = lerEstadoPedidoUnico(updatedNode6.payload);
    expect(estado).not.toBeNull();
    expect(estado?.status).toBe("conflito");
    expect(estado?.decisao).toBeNull();
    expect(estado?.opcoes).toEqual(["vale o contrato", "vale o critério"]);
    expect(estado?.camposFaltantes).toEqual(
      expect.arrayContaining(["QR Pix", "copia-e-cola", "linha digitável"]),
    );

    // 3. Publicou mensagem com uma decisão só: "vale o contrato" ou "vale o critério"
    const messages = await inMemoryDb.prismaMock.message.findMany({ where: { sessionId: session.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('"vale o contrato"');
    expect(messages[0].content).toContain('"vale o critério"');
    expect(messages[0].content).not.toContain("Re-tentar");

    // 4. Não cascateou as etapas 12 e 19
    const cascaded = await cascadeBlockedNodes(session.id);
    expect(cascaded).toEqual([]);
    const afterCascade12 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node12.id } });
    const afterCascade19 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node19.id } });
    expect(afterCascade12.status).toBe("pending");
    expect(afterCascade19.status).toBe("pending");

    // 5. Sem essa escolha, a etapa não volta à fila
    expect(
      blockedTaskReleaseKind({
        status: updatedNode6.status,
        failureHistory: updatedNode6.failureHistory,
        result: updatedNode6.result,
        payload: updatedNode6.payload,
      }),
    ).toBe("keep");
    expect(
      canRetryExhaustedCodeOnResume([
        {
          status: updatedNode6.status,
          failureHistory: updatedNode6.failureHistory,
          result: updatedNode6.result,
          payload: updatedNode6.payload,
        },
      ]),
    ).toBe(false);

    const retrySemEscolha = await retryNodeAndCascade(node6.id);
    expect(retrySemEscolha.ok).toBe(false);
    expect(retrySemEscolha.motivo).toBe("pedido_unico_aberto");
    const stillBlockedNode6 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node6.id } });
    expect(stillBlockedNode6.status).toBe("blocked");
  });

  it("se a skill pedido-unico não carregar, a etapa não executa e não gasta tentativa", async () => {
    const emptySkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-empty-skills-"));
    setPedidoUnicoSkillsRootForTests(emptySkillsDir);

    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-sem-skill",
        executionDirectory: tempDir,
      },
    });

    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-1",
        sessionId: session.id,
        title: "Etapa 1 - Inicial",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 0,
        orderIndex: 1,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/index.ts"]),
        payload: JSON.stringify({
          etapaId: "etapa-1",
          microbrief: criarMicrobriefExemplo({
            criteriosAceitePorReq: { "REQ-001": ["Retorna apenas o id."] },
          }),
        }),
      },
    });

    try {
      const nodeWithSession = await inMemoryDb.prismaMock.taskNode.findUnique({
        where: { id: node.id },
        include: { session: true },
      });
      const res = await executeTaskNode(nodeWithSession);
      expect(res.finalStatus).toBe("blocked");
      expect(hoisted.generateAcceptanceTestsMock).not.toHaveBeenCalled();
      expect(hoisted.dispatchWithFallbackMock).not.toHaveBeenCalled();

      const afterNode = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
      expect(afterNode.attempts).toBe(0);
    } finally {
      fs.rmSync(emptySkillsDir, { recursive: true, force: true });
    }
  });

  it("decisão 'vale o contrato': critério continua no registro, sai do pedido da etapa, e auditoria/teste de aceite não reprovam por campo fora do retorno", async () => {
    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-vale-contrato",
        executionDirectory: tempDir,
      },
    });

    const microbrief = criarMicrobriefExemplo();
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-6-vc",
        sessionId: session.id,
        title: "Etapa 6",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 0,
        orderIndex: 6,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/billing/emitir.ts"]),
        payload: JSON.stringify({ microbrief }),
      },
    });

    const nodeWithSession = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: node.id },
      include: { session: true },
    });

    // Primeiro bloqueia no porteiro
    await executeTaskNode(nodeWithSession);

    // Registra a escolha "vale o contrato"
    const resEscolha = await registrarEscolhaPedidoUnico(node.id, "vale o contrato");
    expect(resEscolha.ok).toBe(true);
    expect(resEscolha.decisao).toBe("vale o contrato");
    expect(resEscolha.statusEtapa).toBe("pending");

    const nodeAfterChoice = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    const parsedPayload = JSON.parse(nodeAfterChoice.payload!);
    const estado = lerEstadoPedidoUnico(nodeAfterChoice.payload)!;

    // O critério original continua no registro da etapa
    expect(parsedPayload.microbrief.criteriosAceitePorReq["REQ-006"][0]).toContain("QR Pix");
    expect(parsedPayload.microbrief.criteriosAceitePorReq["REQ-006"][0]).toContain("copia-e-cola");
    expect(parsedPayload.microbrief.criteriosAceitePorReq["REQ-006"][0]).toContain("linha digitável");

    // E sai do pedido ativo desta etapa
    const activeBrief = filtrarMicrobriefPorValeContrato(
      parsedPayload.microbrief,
      estado.camposFaltantes,
      estado.camposRetornoContrato,
    );
    expect(activeBrief.criteriosAceitePorReq["REQ-006"][0]).not.toContain("QR Pix");
    expect(activeBrief.criteriosAceitePorReq["REQ-006"][0]).not.toContain("copia-e-cola");
    expect(activeBrief.criteriosAceitePorReq["REQ-006"][0]).not.toContain("linha digitável");

    // Teste de aceite não reprova por campo que o retorno do contrato não nomeia
    const testesAceite: AcceptanceTest[] = [
      {
        req: "REQ-006",
        caminho: "aceite-1-cobranca.test.ts",
        conteudo: "expect(res).toHaveProperty('qrPix'); expect(res).toHaveProperty('linhaDigitavel');",
        visivel: true,
      },
    ];
    const aceiteFiltrado = filtrarFalhasAceitePorValeContrato(
      [
        {
          file: ".nextcode-repro/aceite-1-cobranca.test.ts",
          txt: "AssertionError: expected { id: '123' } to have property 'qrPix'",
        },
      ],
      testesAceite,
      estado.camposFaltantes,
    );
    expect(aceiteFiltrado.contar).toHaveLength(0);
    expect(aceiteFiltrado.descartadosPorValeContrato).toHaveLength(1);

    // Auditoria cega não reprova por campo que o retorno do contrato não nomeia
    const auditIn: ValidationType2Result = {
      verdict: "REJECTED",
      rawVerdict: "REPROVADO",
      method: "llm_blind",
      lens1BlindReport: "Faltou retornar QR Pix e copia-e-cola.",
      lens2CrossVerification: "Reprovado",
      rejectionReason: "Faltou retornar QR Pix e copia-e-cola.",
      ressalvas: [],
      problemas: [
        {
          severidade: "critico",
          arquivoLinha: "src/billing/emitir.ts:10",
          descricao: "Retorno não inclui QR Pix nem copia-e-cola.",
        },
      ],
      reqVerdicts: [
        {
          id: "REQ-006",
          status: "parcial",
          evidencia: "src/billing/emitir.ts:10 retorna apenas id, sem QR Pix nem linha digitável.",
        },
      ],
      correcoesSugeridas: [],
    };
    const auditFiltrada = filtrarAuditoriaPorValeContrato(auditIn, estado.camposFaltantes);
    expect(auditFiltrada.verdict).toBe("APPROVED");
    expect(auditFiltrada.problemas).toHaveLength(0);
  });

  it("decisão 'vale o critério': etapa continua sem executor até o contrato guardado na sessão nomear os campos; harness alarga o contrato da sessão só depois da escolha sem editar o projeto alvo", async () => {
    const targetProjectFile = path.join(tempDir, "src", "billing", "emitir.ts");
    fs.mkdirSync(path.dirname(targetProjectFile), { recursive: true });
    const originalProjectFileContent = "export function emitirCobranca() { return { id: '1' }; }\n";
    fs.writeFileSync(targetProjectFile, originalProjectFileContent, "utf-8");

    const assinaturaOriginal = "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>";
    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-vale-criterio",
        executionDirectory: tempDir,
        canonicalSpec: `# Contratos\n${assinaturaOriginal}`,
      },
    });

    const microbrief = criarMicrobriefExemplo({
      interfacesProduz: assinaturaOriginal,
    });

    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-6-vcrit",
        sessionId: session.id,
        title: "Etapa 6",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 0,
        orderIndex: 6,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/billing/emitir.ts"]),
        payload: JSON.stringify({ etapaId: "etapa-6-vcrit", microbrief }),
      },
    });

    const nodeWithSession = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: node.id },
      include: { session: true },
    });

    // 1. Bloqueia no porteiro
    await executeTaskNode(nodeWithSession);

    // 2. Tentar alargar antes da escolha "vale o critério" deve recusar
    const alargarAntes = await alargarContratoDaSessaoAposEscolha(node.id);
    expect(alargarAntes.ok).toBe(false);
    expect(alargarAntes.message).toContain("vale o critério");

    // 3. Registra "vale o critério", mas sem alargar o contrato ainda: etapa continua bloqueada e sem executor
    const escolhaSemAlargar = await registrarEscolhaPedidoUnico(node.id, "vale o critério", {
      alargarContratoNaSessao: false,
    });
    expect(escolhaSemAlargar.ok).toBe(true);
    expect(escolhaSemAlargar.statusEtapa).toBe("blocked");

    const retryAntesDeAlargar = await retryNodeAndCascade(node.id);
    expect(retryAntesDeAlargar.ok).toBe(false);

    // 4. Harness alarga o retorno no contrato da sessão, só depois da escolha
    const alargado = await alargarContratoDaSessaoAposEscolha(node.id);
    expect(alargado.ok).toBe(true);
    expect(alargado.contratoAlargado).toContain("qrPix");
    expect(alargado.contratoAlargado).toContain("copiaECola");
    expect(alargado.contratoAlargado).toContain("linhaDigitavel");

    // Não editou arquivo do projeto alvo para alinhar o contrato
    expect(fs.readFileSync(targetProjectFile, "utf-8")).toBe(originalProjectFileContent);

    // Agora o contrato guardado na sessão nomeia esses campos e a etapa voltou à fila ("pending")
    const nodeDepois = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(nodeDepois.status).toBe("pending");
  });
});

describe("Fatia 1 — Porta da escolha no painel", () => {
  beforeEach(() => {
    inMemoryDb.reset();
    hoisted.generateAcceptanceTestsMock.mockReset();
    hoisted.dispatchWithFallbackMock.mockReset();
  });

  it("recusa a escolha numa etapa bloqueada por outra causa e não mexe nela", async () => {
    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-sem-conflito",
        phase: "BLOQUEADA",
        phaseContext: JSON.stringify({ faseAntesDoBloqueio: "EXECUCAO" }),
        canonicalSpec: "export function emitirCobranca(): Promise<{ id: string }>",
      },
    });
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-outra-causa",
        sessionId: session.id,
        title: "Etapa outra causa",
        status: "blocked",
        attempts: 3,
        payload: JSON.stringify({ microbrief: criarMicrobriefExemplo() }),
        result: JSON.stringify({ rejectionReason: "erro TS2304: Cannot find name 'x'." }),
      },
    });

    const recusa = await aplicarEscolhaHumanaPedidoUnico(node.id, "vale o contrato");
    expect(recusa.ok).toBe(false);

    const depois = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(depois.status).toBe("blocked");
    expect(depois.attempts).toBe(3);
    const sessao = await inMemoryDb.prismaMock.session.findUnique({ where: { id: session.id } });
    expect(sessao.phase).toBe("BLOQUEADA");
  });

  it("vale o contrato devolve só a etapa do conflito à fila e deixa as outras bloqueadas", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pedido-unico-porta-"));
    const alvo = path.join(tempDir, "src", "billing", "emitir.ts");
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const conteudoAlvo = "export function emitirCobranca() { return { id: '1' }; }\n";
    fs.writeFileSync(alvo, conteudoAlvo, "utf-8");

    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-porta-contrato",
        phase: "BLOQUEADA",
        phaseContext: JSON.stringify({ faseAntesDoBloqueio: "EXECUCAO" }),
        executionDirectory: tempDir,
        canonicalSpec: "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>",
      },
    });
    const conflito = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-conflito",
        sessionId: session.id,
        title: "Etapa do conflito",
        status: "pending",
        attempts: 0,
        orderIndex: 9,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/billing/emitir.ts"]),
        payload: JSON.stringify({ etapaId: "etapa-conflito", microbrief: criarMicrobriefExemplo() }),
      },
    });
    const propria = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-12",
        sessionId: session.id,
        title: "Etapa 12",
        status: "blocked",
        attempts: 3,
        orderIndex: 12,
        dependencies: JSON.stringify(["etapa-conflito"]),
        result: JSON.stringify({ rejectionReason: "falha própria" }),
      },
    });

    const carregada = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: conflito.id },
      include: { session: true },
    });
    await executeTaskNode(carregada);
    const parada = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: conflito.id } });
    expect(parada.status).toBe("blocked");
    expect(parada.attempts).toBe(0);

    const escolha = await aplicarEscolhaHumanaPedidoUnico(conflito.id, "vale o contrato");
    expect(escolha.ok).toBe(true);
    expect(escolha.statusEtapa).toBe("pending");

    const depois = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: conflito.id } });
    expect(depois.status).toBe("pending");
    expect(depois.attempts).toBe(0);
    const outra = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: propria.id } });
    expect(outra.status).toBe("blocked");
    expect(outra.attempts).toBe(3);
    const sessao = await inMemoryDb.prismaMock.session.findUnique({ where: { id: session.id } });
    expect(sessao.phase).toBe("EXECUCAO");
    expect(fs.readFileSync(alvo, "utf-8")).toBe(conteudoAlvo);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("vale o critério alarga o contrato da sessão, devolve a etapa à fila e não edita o projeto alvo", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pedido-unico-criterio-"));
    const alvo = path.join(tempDir, "src", "billing", "emitir.ts");
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const conteudoAlvo = "export function emitirCobranca() { return { id: '1' }; }\n";
    fs.writeFileSync(alvo, conteudoAlvo, "utf-8");
    const assinatura = "export function emitirCobranca(input: CobrancaInput): Promise<{ id: string }>";

    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-porta-criterio",
        phase: "BLOQUEADA",
        phaseContext: JSON.stringify({ faseAntesDoBloqueio: "EXECUCAO" }),
        executionDirectory: tempDir,
        canonicalSpec: `# Contratos\n${assinatura}`,
      },
    });
    const conflito = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-criterio-porta",
        sessionId: session.id,
        title: "Etapa do critério",
        status: "pending",
        attempts: 0,
        orderIndex: 9,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/billing/emitir.ts"]),
        payload: JSON.stringify({
          etapaId: "etapa-criterio-porta",
          microbrief: criarMicrobriefExemplo({ interfacesProduz: assinatura }),
        }),
      },
    });
    const carregada = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: conflito.id },
      include: { session: true },
    });
    await executeTaskNode(carregada);

    const escolha = await aplicarEscolhaHumanaPedidoUnico(conflito.id, "vale o critério");
    expect(escolha.ok).toBe(true);
    expect(escolha.statusEtapa).toBe("pending");

    const sessao = await inMemoryDb.prismaMock.session.findUnique({ where: { id: session.id } });
    expect(sessao.phase).toBe("EXECUCAO");
    expect(sessao.canonicalSpec).toContain("qrPix");
    expect(sessao.canonicalSpec).toContain("copiaECola");
    expect(sessao.canonicalSpec).toContain("linhaDigitavel");
    expect(fs.readFileSync(alvo, "utf-8")).toBe(conteudoAlvo);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("escolha antiga com campo opcional volta ao painel, reescreve o contrato e não abre tentativa nova", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pedido-unico-reabre-"));
    const alvo = path.join(tempDir, "src", "lib", "cobrancas-service.ts");
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const conteudoAlvo = "export async function criarCobrancaParaLojista() { return { id: '1' }; }\n";
    fs.writeFileSync(alvo, conteudoAlvo, "utf-8");

    const linhaCobranca =
      "export type FnCriarCobrancaParaLojista = (dados: { lojistaId: string }) => Promise<{ id: string; qrPix?: string; linhaDigitavel?: string; VENCIDA?: unknown }>;";
    const linhaIndicadores =
      "export type FnObterIndicadores = (lojistaId: string, de: string, ate: string) => Promise<{ recebido: number; pendente: number; inadimplente: number; qrPix?: string; linhaDigitavel?: string; VENCIDA?: unknown }>;";
    const criterios = {
      "REQ-027": [
        "src/lib/cobrancas-service.ts exporta criarCobrancaParaLojista e devolve os dados de pagamento (QR Pix, linha digitável ou resultado do cartão).",
      ],
      "REQ-050": ["src/lib/relatorios.ts exporta obterIndicadores e devolve inadimplente (VENCIDA), recebido e pendente."],
    };
    const payload = JSON.stringify({
      etapaId: "etapa-9",
      microbrief: criarMicrobriefExemplo({
        interfacesProduz: `${linhaCobranca}\n${linhaIndicadores}`,
        criteriosAceitePorReq: criterios,
      }),
      pedidoUnico: {
        status: "resolvido",
        decisao: "vale o critério",
        decisaoNormalizada: "vale_criterio",
        camposFaltantes: [],
      },
    });
    const result = JSON.stringify({ rejectionReason: "auditoria cega", pedidoUnicoAguardandoDecisao: false });
    const canonicalSpec = `# contrato\n${linhaCobranca}\n\nnota\n${linhaIndicadores}`;

    const session = await inMemoryDb.prismaMock.session.create({
      data: {
        id: "sess-reabre",
        phase: "BLOQUEADA",
        phaseContext: JSON.stringify({ faseAntesDoBloqueio: "EXECUCAO" }),
        executionDirectory: tempDir,
        canonicalSpec,
      },
    });
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-9-reabre",
        sessionId: session.id,
        title: "Etapa 9",
        status: "blocked",
        attempts: 3,
        orderIndex: 9,
        filesScope: JSON.stringify(["src/lib/cobrancas-service.ts"]),
        payload,
        result,
      },
    });

    const marcada = marcarEscolhaPedidoUnicoNoPainel([{ payload, result, status: "blocked" }], canonicalSpec);
    expect(marcada[0].pedidoUnicoAguardandoDecisao).toBe(true);
    expect(pedidoUnicoAguardandoEscolha(result, payload, true)).toBe(true);

    const escolha = await aplicarEscolhaHumanaPedidoUnico(node.id, "vale o critério");
    expect(escolha.ok).toBe(true);
    expect(escolha.statusEtapa).toBe("blocked");

    const sessao = await inMemoryDb.prismaMock.session.findUnique({ where: { id: session.id } });
    expect(sessao.phase).toBe("BLOQUEADA");
    expect(sessao.canonicalSpec).toContain("qrPix: string");
    expect(sessao.canonicalSpec).toContain("linhaDigitavel: string");
    expect(sessao.canonicalSpec).not.toContain("qrPix?");
    expect(sessao.canonicalSpec).not.toContain("VENCIDA");
    const indicadores = sessao.canonicalSpec.split("\n").find((linha: string) => linha.includes("FnObterIndicadores"));
    expect(indicadores).not.toContain("qrPix");
    expect(indicadores).not.toContain("linhaDigitavel");

    const depois = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(depois.status).toBe("blocked");
    expect(depois.attempts).toBe(3);
    expect(fs.readFileSync(alvo, "utf-8")).toBe(conteudoAlvo);
    const aindaAberta = marcarEscolhaPedidoUnicoNoPainel(
      [{ payload: depois.payload, result: depois.result, status: depois.status }],
      sessao.canonicalSpec
    );
    expect(aindaAberta[0].pedidoUnicoAguardandoDecisao).toBe(false);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("Fatia 2 — A mesma lacuna na tentativa seguinte e aviso com Re-tentar", () => {
  it("repete a citação arquivo:linha da rejeição anterior enquanto o código novo não mostrar que aquele trecho mudou, acrescentando lacuna nova sem apagar a anterior", () => {
    const codigoTentativa1 = {
      "src/billing/emitir.ts": [
        "export function emitirCobranca(valor: number) {",
        "  if (valor <= 0) return null;",
        "  return { id: 'fixo' };",
        "}",
      ].join("\n"),
    };

    // Na tentativa 2, linha 3 não mudou; só mexeu num comentário na linha 1
    const codigoTentativa2SemMudarLinha3 = {
      "src/billing/emitir.ts": [
        "export function emitirCobranca(valor: number) { // comentario",
        "  if (valor <= 0) return null;",
        "  return { id: 'fixo' };",
        "}",
      ].join("\n"),
    };

    expect(
      trechoCitadoMudouNoCodigoNovo(
        {
          arquivo: "src/billing/emitir.ts",
          linhaInicio: 3,
          linhaFim: 3,
        },
        codigoTentativa1,
        codigoTentativa2SemMudarLinha3,
      ),
    ).toBe(false);

    // Auditoria da tentativa 2 veio com lista diferente, mas não mudou a linha 3:
    // não tratar como "já corrigido" e manter a lacuna anterior junto com a lacuna nova.
    const resultadoTentativa2 = aplicarReguaMesmaLacuna({
      rejeicaoAnterior: "src/billing/emitir.ts:3 — ID fixo sem persistência no banco",
      codigoAnterior: codigoTentativa1,
      codigoNovo: codigoTentativa2SemMudarLinha3,
      rejeicaoNova: "src/billing/emitir.ts:2 — Retorno null silencioso sem erro tipado.",
      problemasNovos: [
        {
          severidade: "critico",
          arquivoLinha: "src/billing/emitir.ts:2",
          descricao: "Retorno null silencioso sem erro tipado.",
        },
      ],
    });

    expect(resultadoTentativa2.forcarRejeicao).toBe(true);
    expect(resultadoTentativa2.problemasFinais).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arquivoLinha: "src/billing/emitir.ts:3",
        }),
        expect.objectContaining({
          arquivoLinha: "src/billing/emitir.ts:2",
        }),
      ]),
    );
    expect(resultadoTentativa2.rejeicaoFinal).toContain("src/billing/emitir.ts:3");
    expect(resultadoTentativa2.rejeicaoFinal).toContain("src/billing/emitir.ts:2");
  });

  it("não trata auditoria que aprovaria com lista vazia como 'já corrigido' quando o trecho arquivo:linha não mudou", async () => {
    const codigoSemMudanca = {
      "src/service.ts": [
        "export function pagar() {",
        "  return { status: 'pendente' };",
        "}",
      ].join("\n"),
    };

    const res = await DualLensAuditor.validateType2(
      { passed: true, compilationErrors: [], securityViolations: [], testFailures: [] },
      "# Etapa\nImplementar pagamento real.",
      "Implementado com sucesso.",
      codigoSemMudanca,
      async () =>
        JSON.stringify({
          implemented: true,
          veredito: "APROVADO",
          problemas: [],
          ressalvas: [],
          correcoesSugeridas: [],
          fatoQueGarante: "src/service.ts:2 retorna status",
          nivelProva: "arquivo_linha",
        }),
      {
        cluster: "backend",
        rejeicaoAnterior: "src/service.ts:2 — status fixo sem chamar gateway",
        codigoAnterior: codigoSemMudanca,
      },
    );

    expect(res.verdict).toBe("REJECTED");
    expect(res.rawVerdict).toBe("REPROVADO");
    expect(res.problemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arquivoLinha: "src/service.ts:2",
        }),
      ]),
    );
    expect(res.rejectionReason).toContain("src/service.ts:2");
  });

  it("quando o código novo mostra que o trecho citado mudou, não força a repetição da citação antiga", () => {
    const codigoTentativa1 = {
      "src/service.ts": [
        "export function pagar() {",
        "  return { status: 'pendente' };",
        "}",
      ].join("\n"),
    };
    const codigoTentativa2MudouLinha2 = {
      "src/service.ts": [
        "export function pagar() {",
        "  return gateway.executarPagamento();",
        "}",
      ].join("\n"),
    };

    const resultado = aplicarReguaMesmaLacuna({
      rejeicaoAnterior: "src/service.ts:2 — status fixo sem chamar gateway",
      codigoAnterior: codigoTentativa1,
      codigoNovo: codigoTentativa2MudouLinha2,
      rejeicaoNova: undefined,
      problemasNovos: [],
    });

    expect(resultado.forcarRejeicao).toBe(false);
    expect(resultado.problemasFinais).toHaveLength(0);
    expect(resultado.lacunasQuePermaneceram).toHaveLength(0);
  });

  it("aviso de lacuna permanente nomeia a lacuna que permaneceu, traz o botão Re-tentar, mantém a Spec e não pede para dividir a Spec", () => {
    const avisoDireto = construirAvisoLacunaPermanente([
      "src/billing/emitir.ts:3 — ID fixo sem persistência",
    ]);
    expect(avisoDireto).toContain("src/billing/emitir.ts:3");
    expect(avisoDireto).toContain("A Spec permanece.");
    expect(avisoDireto).toContain("Re-tentar");
    expect(avisoDireto.toLowerCase()).not.toContain("dividir a spec");
    expect(avisoDireto.toLowerCase()).not.toContain("divida a spec");

    const report = IncidentReporter.generateIncidentReport(
      "node-6",
      "Etapa 6 - Emissão",
      "backend-api",
      [
        {
          attemptNumber: 1,
          rejectionReason:
            "Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: src/billing/emitir.ts:3 — ID fixo sem persistência",
          filesScope: ["src/billing/emitir.ts"],
          timestamp: "2026-10-03T00:00:00.000Z",
        },
        {
          attemptNumber: 2,
          rejectionReason:
            "Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: src/billing/emitir.ts:3 — ID fixo sem persistência; src/billing/emitir.ts:2 — falta validação",
          filesScope: ["src/billing/emitir.ts"],
          timestamp: "2026-10-03T00:01:00.000Z",
        },
      ],
    );

    expect(report).toContain("src/billing/emitir.ts:3");
    expect(report).toContain("A Spec permanece.");
    expect(report).toContain("Re-tentar");
    expect(report.toLowerCase()).not.toContain("dividir a spec");
    expect(report.toLowerCase()).not.toContain("divida a spec");
  });

  it("reconcilia conflito gravado obsoleto e remove pedidoUnico do payload", async () => {
    const interfacesProduz =
      "export type ItemSaida = { titulo: string; modos: ('A' | 'B')[]; precos: { forma: string; parcelas: number }[] };";
    const payloadAntes = JSON.stringify({
      microbrief: {
        interfacesProduz,
        criteriosAceitePorReq: { "REQ-1": ["GET devolve 200 {titulo, precos[{forma, parcelas}]}." ] },
      },
      pedidoUnico: {
        status: "conflito",
        camposFaltantes: ["titulo"],
        criteriosEmConflito: ["GET devolve 200 {titulo, precos[{forma, parcelas}]}."],
        decisaoNormalizada: null,
      },
    });
    const resultAntes = JSON.stringify({
      erro: "CONFLITO_PEDIDO_UNICO",
      pedidoUnicoAguardandoDecisao: true,
    });
    const patch = reconciliarPedidoUnicoObsoletoNoRegistro({ payload: payloadAntes, result: resultAntes });
    expect(patch.alterou).toBe(true);
    expect(patch.payload).not.toContain("pedidoUnico");
    expect(JSON.parse(patch.result!).pedidoUnicoAguardandoDecisao).toBe(false);

    const sess = await inMemoryDb.prismaMock.session.create({
      data: { id: "sess-recon", canonicalSpec: null, specVersion: 1 },
    });
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "node-recon",
        sessionId: sess.id,
        specVersion: 1,
        status: "blocked",
        payload: payloadAntes,
        result: resultAntes,
      },
    });
    expect(registroPossuiMarcaPedidoUnicoObsoleta({ payload: payloadAntes, result: resultAntes })).toBe(true);
    const ok = await persistirReconciliacaoPedidoUnicoObsoleto(node.id, null);
    expect(ok).toBe(true);
    const depois = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(depois.payload).not.toContain("pedidoUnico");
    expect(JSON.parse(depois.result).pedidoUnicoAguardandoDecisao).toBe(false);
  });

  it.each([
    {
      nome: "conflito aberto aguardando escolha",
      task: {
        status: "blocked",
        payload: JSON.stringify({
          microbrief: {
            interfacesProduz: "export type Cobranca = { id: string };",
            criteriosAceitePorReq: { "REQ-1": ["Retorna QR Pix."] },
          },
          pedidoUnico: { status: "conflito", decisaoNormalizada: null, camposFaltantes: ["QR Pix"] },
        }),
        result: JSON.stringify({ pedidoUnicoAguardandoDecisao: true, erro: "CONFLITO_PEDIDO_UNICO" }),
      },
    },
    {
      nome: "conflito obsoleto coerente",
      task: {
        status: "blocked",
        payload: JSON.stringify({
          microbrief: {
            interfacesProduz:
              "export type ItemSaida = { titulo: string; modos: ('A' | 'B')[]; precos: { forma: string; parcelas: number }[] };",
            criteriosAceitePorReq: { "REQ-1": ["GET devolve 200 {titulo, precos[{forma, parcelas}]}." ] },
          },
          pedidoUnico: { status: "conflito", decisaoNormalizada: null },
        }),
        result: JSON.stringify({ pedidoUnicoAguardandoDecisao: true, erro: "CONFLITO_PEDIDO_UNICO" }),
      },
    },
    {
      nome: "skill pedido-unico inválida",
      task: {
        status: "blocked",
        payload: JSON.stringify({ microbrief: { interfacesProduz: "export type T = { id: string };" } }),
        result: JSON.stringify({ erro: "SKILL_PEDIDO_UNICO_INVALIDA", pedidoUnicoAguardandoDecisao: true }),
      },
    },
  ])("paridade painel e porteiro — $nome", ({ task }) => {
    expect(painelCoerenteComPorteiroPedidoUnico(task)).toBe(true);
  });

  it("POST retry_node recusa com 409 e motivo pedido_unico_aberto", async () => {
    inMemoryDb.reset();
    const sess = await inMemoryDb.prismaMock.session.create({
      data: { id: "sess-retry-api", specVersion: 1, phase: "BLOQUEADA", canonicalSpec: null },
    });
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "node-retry-api",
        sessionId: sess.id,
        specVersion: 1,
        title: "Etapa teste",
        status: "blocked",
        payload: JSON.stringify({
          microbrief: {
            interfacesProduz: "export type Cobranca = { id: string };",
            criteriosAceitePorReq: { "REQ-1": ["Retorna QR Pix, copia-e-cola e linha digitável."] },
          },
          pedidoUnico: {
            status: "conflito",
            decisaoNormalizada: null,
            camposFaltantes: ["QR Pix"],
          },
        }),
        result: JSON.stringify({ pedidoUnicoAguardandoDecisao: true }),
      },
    });

    const req = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry_node", nodeId: node.id }),
    });
    const res = await postDag(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.motivo).toBe("pedido_unico_aberto");
    expect(String(body.error)).toContain("pedido único");
  });

  it("classifica HTTP 502 upstream provider errors (Last error: fetch) como espera e não como falha de crédito/chave", async () => {
    const { classifyProviderOutage, isUpstreamTransportOrServerOutage } = await import("@/core/llm/gateways");
    const msg =
      "All 1 routed attempt(s) failed with upstream provider errors (error ×1). This is a provider-side failure, not a problem with your request; retry, or check provider status. Attempt trail: custom/deepseek-v4-pro key1: error. Last error: fetch";
    expect(isUpstreamTransportOrServerOutage(msg, 502)).toBe(true);
    expect(classifyProviderOutage(msg, 502)).toBe("espera");
    expect(classifyProviderOutage("out_of_credits", 402)).toBe("credito");
    expect(classifyProviderOutage("invalid api key", 401)).toBe("chave");
  });
});
