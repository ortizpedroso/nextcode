import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";
import {
  escopoMicrobriefAindaImpede,
  mensagemEscopoMicrobriefIncompleto,
  simbolosProduzidosCitadosNoCriterio,
  stripEscopoMicrobriefAposConclusao,
  verificarEscopoMicrobrief,
} from "@/core/governance/microbrief-escopo";
import { pedidoUnicoAguardandoEscolha } from "@/lib/pedido-unico-ui";

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
        const rec = { id: data.id, canonicalSpec: data.canonicalSpec ?? null, project: null, ...data };
        sessions.set(rec.id, rec);
        return { ...rec };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sessions.get(where.id);
        return s ? { ...s } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = sessions.get(where.id);
        if (!s) throw new Error("session");
        const updated = { ...s, ...data };
        sessions.set(where.id, updated);
        return { ...updated };
      }),
    },
    taskNode: {
      create: vi.fn(async ({ data }: any) => {
        const rec = {
          id: data.id,
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
          specVersion: data.specVersion ?? 0,
        };
        taskNodes.set(rec.id, rec);
        return { ...rec };
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const n = taskNodes.get(where.id);
        if (!n) return null;
        const copy = { ...n };
        if (include?.session) {
          copy.session = { ...(sessions.get(n.sessionId) ?? { id: n.sessionId, canonicalSpec: null, project: null }) };
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
        if (where?.sessionId) list = list.filter((n) => n.sessionId === where.sessionId);
        return list;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const n = taskNodes.get(where.id);
        if (!n) throw new Error(`TaskNode ${where.id} not found`);
        const updated = { ...n, ...data };
        taskNodes.set(where.id, updated);
        return { ...updated };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, n] of taskNodes.entries()) {
          if (where?.id && n.id !== where.id) continue;
          if (where?.sessionId && n.sessionId !== where.sessionId) continue;
          if (where?.status?.in && !where.status.in.includes(n.status)) continue;
          taskNodes.set(id, { ...n, ...data });
          count++;
        }
        return { count };
      }),
    },
    message: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: any = {}) =>
        messages.filter((m) => (!where?.sessionId ? true : m.sessionId === where.sessionId))
      ),
      create: vi.fn(async ({ data }: any) => {
        const msg = { id: nextId("msg"), ...data };
        messages.push(msg);
        return msg;
      }),
    },
    setting: { findUnique: vi.fn(async () => null) },
    telemetryLog: { create: vi.fn(async ({ data }: any) => ({ id: nextId("tel"), ...data })) },
    telemetryEvent: { create: vi.fn(async ({ data }: any) => ({ id: nextId("tel"), ...data })) },
  };
  return { prismaMock, reset, messages };
});

const hoisted = vi.hoisted(() => ({
  generateAcceptanceTestsMock: vi.fn(),
  dispatchWithFallbackMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: inMemoryDb.prismaMock,
  prisma: inMemoryDb.prismaMock,
}));

vi.mock("@/core/governance/acceptance-tests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/governance/acceptance-tests")>();
  return { ...actual, generateAcceptanceTests: hoisted.generateAcceptanceTestsMock };
});

vi.mock("@/core/llm/smart-router", () => ({
  SmartRouter: class {
    dispatchWithFallback = hoisted.dispatchWithFallbackMock;
  },
}));

import { executeTaskNode, cascadeBlockedNodes } from "@/core/orchestrator/node-executor";
import { blockedTaskReleaseKind, canRetryExhaustedCodeOnResume, retryNodeAndCascade, textoDeRetomarComBloqueio } from "@/core/orchestrator/session-resume";

function microbrief(overrides: Partial<MicrobriefAndReportDocument> = {}): MicrobriefAndReportDocument {
  return {
    documento: "microbrief",
    idMicrobrief: "MB-9",
    idMacrobrief: "MACRO-1",
    idProjeto: "proj-1",
    cluster: "backend",
    nivelModeloSugerido: "medio",
    dependeDe: [],
    reqsCobertos: ["REQ-009"],
    arquivosPermitidos: {
      criar: ["src/app/api/cobranca/route.ts"],
      modificar: [],
      lerContratos: [],
    },
    statusExecucao: "PENDENTE",
    tentativaAtual: 0,
    medidoPeloHarness: { compilou: null, testes: null, arquivosAlterados: [] },
    interfacesConsome: [],
    interfacesProduz: "export function listarCobrancas(): Promise<{ id: string }>",
    criteriosAceitePorReq: {
      "REQ-009": ["O arquivo src/lib/cobranca.ts exporta obterCobranca()."],
    },
    registroCumprimento: [],
    ...overrides,
  };
}

describe("microbrief: arquivo exato e símbolo produzido", () => {
  it("critério que nomeia arquivo e símbolo fora da lista não é coerente", () => {
    const r = verificarEscopoMicrobrief(microbrief());
    expect(r.coerente).toBe(false);
    expect(r.arquivosForaDoMicrobrief).toEqual(["src/lib/cobranca.ts"]);
    expect(r.simbolosForaDoMicrobrief).toEqual(["obterCobranca"]);
    expect(r.semArquivoDeEscrita).toBe(false);
  });

  it("arquivo e símbolo listados no microbrief passam", () => {
    const r = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: {
          criar: ["src/lib/cobranca.ts"],
          modificar: [],
          lerContratos: ["src/lib/validacao.ts"],
        },
        interfacesProduz: "export function obterCobranca(): Promise<{ id: string }>",
        criteriosAceitePorReq: {
          "REQ-009": ["O arquivo src/lib/cobranca.ts exporta obterCobranca(). Usa src/lib/validacao.ts."],
        },
      })
    );
    expect(r.coerente).toBe(true);
    expect(r.arquivosForaDoMicrobrief).toEqual([]);
    expect(r.simbolosForaDoMicrobrief).toEqual([]);
  });

  it("o que o critério devolve não vira símbolo; outro nome exportado continua parando a etapa", () => {
    const soResultado = "src/lib/pedido.ts exporta fecharPedido(clienteId), que devolve o total (soma de valorItens) e a sigla API.";
    expect(simbolosProduzidosCitadosNoCriterio(soResultado)).toEqual(["fecharPedido"]);
    const resultadoListado = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: { criar: ["src/lib/pedido.ts"], modificar: [], lerContratos: [] },
        interfacesProduz: "export function fecharPedido(clienteId: string): Promise<{ id: string }>",
        criteriosAceitePorReq: { "REQ-001": [soResultado] },
      })
    );
    expect(resultadoListado.simbolosForaDoMicrobrief).toEqual([]);
    expect(resultadoListado.coerente).toBe(true);

    const segundaExportacao = "src/lib/pedido.ts exporta fecharPedido() e emitirRecibo, que devolve o id.";
    expect(simbolosProduzidosCitadosNoCriterio(segundaExportacao)).toEqual(["fecharPedido", "emitirRecibo"]);
    const faltaASegunda = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: { criar: ["src/lib/pedido.ts"], modificar: [], lerContratos: [] },
        interfacesProduz: "export function fecharPedido(): Promise<{ id: string }>",
        criteriosAceitePorReq: { "REQ-001": [segundaExportacao] },
      })
    );
    expect(faltaASegunda.simbolosForaDoMicrobrief).toEqual(["emitirRecibo"]);
    expect(faltaASegunda.coerente).toBe(false);
  });

  it("tipo depois de de e meio depois de via não são símbolo; o nome exportado antes continua", () => {
    const instancia = "src/lib/cliente.ts exporta uma instância única de TipoCliente, reaproveitada via cacheGlobal.";
    expect(simbolosProduzidosCitadosNoCriterio(instancia)).toEqual([]);
    const coerente = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: { criar: ["src/lib/cliente.ts"], modificar: [], lerContratos: [] },
        interfacesProduz: "export const cliente = {}",
        criteriosAceitePorReq: { "REQ-001": [instancia] },
      })
    );
    expect(coerente.simbolosForaDoMicrobrief).toEqual([]);
    expect(coerente.coerente).toBe(true);

    const nomeAntes = "src/lib/pedido.ts exporta fecharPedido de pedidos.";
    expect(simbolosProduzidosCitadosNoCriterio(nomeAntes)).toEqual(["fecharPedido"]);
  });

  it("campo de retorno no critério não é símbolo produzido (isso é o pedido único)", () => {
    const criterio = "Ao emitir cobrança, deve retornar o id, o QR Pix, o copia-e-cola e a linha digitável.";
    expect(simbolosProduzidosCitadosNoCriterio(criterio)).toEqual([]);
    const r = verificarEscopoMicrobrief(
      microbrief({
        criteriosAceitePorReq: { "REQ-009": [criterio] },
        interfacesProduz: "export function emitirCobranca(): Promise<{ id: string }>",
        arquivosPermitidos: { criar: ["src/billing/emitir.ts"], modificar: [], lerContratos: [] },
      })
    );
    expect(r.coerente).toBe(true);
  });

  it("função que o contrato já nomeia passa; usa função alheia não vira símbolo produzido", () => {
    const r = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: {
          criar: ["src/lib/calc.ts"],
          modificar: [],
          lerContratos: ["src/lib/validacao.ts"],
        },
        interfacesProduz: "export function sum(a: number, b: number): number",
        interfacesConsome: ["export function validarDocumento(valor: string): boolean"],
        criteriosAceitePorReq: {
          "REQ-001": [
            "A função sum(a, b) deve retornar a soma aritmética de a e b. Usa a função validarDocumento() de src/lib/validacao.ts.",
          ],
        },
      })
    );
    expect(r.simbolosCitadosNoCriterio).toEqual(["sum"]);
    expect(r.coerente).toBe(true);
  });

  it("microbrief sem arquivo para criar ou modificar para", () => {
    const r = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: { criar: [], modificar: [], lerContratos: ["src/lib/validacao.ts"] },
        criteriosAceitePorReq: { "REQ-009": ["Retorna apenas o id."] },
        interfacesProduz: "export function listarCobrancas(): Promise<{ id: string }>",
      })
    );
    expect(r.coerente).toBe(false);
    expect(r.semArquivoDeEscrita).toBe(true);
    expect(mensagemEscopoMicrobriefIncompleto("Etapa 9", r)).toContain("não nomeia arquivo");
    expect(mensagemEscopoMicrobriefIncompleto("Etapa 9", r)).not.toContain("vale o contrato");
  });

  it("FnObterCobranca no contrato cobre o símbolo obterCobranca", () => {
    const r = verificarEscopoMicrobrief(
      microbrief({
        arquivosPermitidos: { criar: ["src/lib/cobranca.ts"], modificar: [], lerContratos: [] },
        interfacesProduz: "export type FnObterCobranca = () => Promise<{ id: string }>",
      })
    );
    expect(r.simbolosForaDoMicrobrief).toEqual([]);
    expect(r.coerente).toBe(true);
  });
});

describe("porteiro antes do executor", () => {
  beforeEach(() => {
    inMemoryDb.reset();
    hoisted.generateAcceptanceTestsMock.mockReset();
    hoisted.dispatchWithFallbackMock.mockReset();
  });

  it("para antes de generateAcceptanceTests e do executor, não gasta tentativa e não cascateia falha própria", async () => {
    const session = await inMemoryDb.prismaMock.session.create({
      data: { id: "sess-escopo", canonicalSpec: "spec", specVersion: 1 },
    });
    const node = await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-9",
        sessionId: session.id,
        title: "Etapa 9 - Cobrança",
        role: "executor-backend",
        cluster: "backend",
        status: "pending",
        attempts: 2,
        orderIndex: 9,
        dependencies: "[]",
        filesScope: JSON.stringify(["src/app/api/cobranca/route.ts"]),
        payload: JSON.stringify({ etapaId: "etapa-9", microbrief: microbrief() }),
      },
    });
    await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-12",
        sessionId: session.id,
        title: "Etapa 12",
        status: "blocked",
        attempts: 3,
        orderIndex: 12,
        dependencies: JSON.stringify(["etapa-9"]),
        result: JSON.stringify({ rejectionReason: "falha própria da etapa 12" }),
        failureHistory: JSON.stringify([{ rejectionReason: "falha própria da etapa 12" }]),
      },
    });
    await inMemoryDb.prismaMock.taskNode.create({
      data: {
        id: "etapa-19",
        sessionId: session.id,
        title: "Etapa 19",
        status: "pending",
        attempts: 0,
        orderIndex: 19,
        dependencies: JSON.stringify(["etapa-9"]),
      },
    });

    const carregada = await inMemoryDb.prismaMock.taskNode.findUnique({
      where: { id: node.id },
      include: { session: true },
    });
    const result = await executeTaskNode(carregada);
    expect(result.finalStatus).toBe("blocked");
    expect(hoisted.generateAcceptanceTestsMock).not.toHaveBeenCalled();
    expect(hoisted.dispatchWithFallbackMock).not.toHaveBeenCalled();

    const parada = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(parada.status).toBe("blocked");
    expect(parada.attempts).toBe(2);
    const resultado = JSON.parse(parada.result);
    expect(resultado.erro).toBe("ESCOPO_MICROBRIEF_INCOMPLETO");
    expect(resultado.pedidoUnicoAguardandoDecisao).toBeUndefined();
    expect(resultado.opcoes).toBeUndefined();
    expect(pedidoUnicoAguardandoEscolha(parada.result, parada.payload)).toBe(false);
    expect(JSON.parse(parada.payload).microbrief.criteriosAceitePorReq["REQ-009"][0]).toContain("obterCobranca");

    const mensagens = await inMemoryDb.prismaMock.message.findMany({ where: { sessionId: session.id } });
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].content).toContain("src/lib/cobranca.ts");
    expect(mensagens[0].content).toContain("obterCobranca");
    expect(mensagens[0].content).not.toContain("vale o contrato");
    expect(mensagens[0].content).not.toContain("vale o critério");

    const cascata = await cascadeBlockedNodes(session.id);
    expect(cascata).toEqual([]);
    const etapa12 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: "etapa-12" } });
    const etapa19 = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: "etapa-19" } });
    expect(etapa12.status).toBe("blocked");
    expect(etapa12.attempts).toBe(3);
    expect(etapa19.status).toBe("pending");

    expect(
      blockedTaskReleaseKind({
        payload: parada.payload,
        failureHistory: parada.failureHistory,
        result: parada.result,
      })
    ).toBe("keep");
    expect(
      canRetryExhaustedCodeOnResume([
        { payload: parada.payload, failureHistory: parada.failureHistory },
      ])
    ).toBe(false);
    const retry = await retryNodeAndCascade(node.id);
    expect(retry.ok).toBe(false);
    const ainda = await inMemoryDb.prismaMock.taskNode.findUniqueOrThrow({ where: { id: node.id } });
    expect(ainda.status).toBe("blocked");
    expect(ainda.attempts).toBe(2);
    expect(escopoMicrobriefAindaImpede(ainda)).toBe(true);
  });
});

describe("marca velha e texto de retomada", () => {
  it("conclusão apaga a marca de escopo e mantém o resto do payload", () => {
    const payload = JSON.stringify({
      goal: "cobrar",
      escopoMicrobrief: { incompleto: true, simbolosFora: ["taxaTotalCentavos"] },
    });
    const limpo = stripEscopoMicrobriefAposConclusao(payload);
    expect(limpo).toBeDefined();
    expect(JSON.parse(limpo as string).escopoMicrobrief).toBeUndefined();
    expect(JSON.parse(limpo as string).goal).toBe("cobrar");
    expect(stripEscopoMicrobriefAposConclusao(JSON.stringify({ goal: "cobrar" }))).toBeUndefined();
  });

  it("Retomar de microbrief incompleto não pede nova aprovação da Spec", () => {
    const texto = textoDeRetomarComBloqueio([
      {
        title: "Etapa 9",
        payload: JSON.stringify({
          microbrief: microbrief(),
          escopoMicrobrief: { incompleto: true, simbolosFora: ["obterCobranca"] },
        }),
      },
    ]);
    expect(texto).toContain("microbrief não lista");
    expect(texto).toContain("não precisa ser aprovada de novo");
  });
});
