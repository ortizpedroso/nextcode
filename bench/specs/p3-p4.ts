// Specs do P3 e do P4, escritas pelo auditor junto com a régua (bench/aceite/auth.mjs e correcao-tarefas.mjs).
// O bench importa estes objetos sem alterar. Mudou a Spec → a régua precisa ser provada de novo.
import type { SpecFrontmatterInput } from "@/core/intake/spec-format";

export const P3_SPEC: SpecFrontmatterInput = {
  titulo: "Login com Sessão (P3)",
  status: "aguardando_aprovacao",
  data: "2026-10-09",
  stack: ["Next.js", "TypeScript"],
  modulos: [
    {
      id: "mod-auth",
      nome: "Usuários e Sessões em Memória",
      resumo:
        "Cadastro de usuários com senha guardada só como hash (node:crypto scrypt com sal) e sessões por token aleatório.",
      arquivos: ["src/lib/auth.ts"],
    },
    {
      id: "mod-api-auth",
      nome: "Rotas de Autenticação",
      resumo: "Registrar, entrar, consultar a sessão e sair.",
      arquivos: [
        "src/app/api/auth/registrar/route.ts",
        "src/app/api/auth/login/route.ts",
        "src/app/api/auth/sessao/route.ts",
        "src/app/api/auth/logout/route.ts",
      ],
    },
  ],
  entidades: [
    {
      nome: "Usuario",
      campos: [
        { nome: "id", tipo: "string" },
        { nome: "email", tipo: "string" },
        { nome: "senhaHash", tipo: "string" },
      ],
    },
  ],
  rotas: [
    { caminho: "/api/auth/registrar", descricao: "POST {email, senha}: cria o usuário." },
    { caminho: "/api/auth/login", descricao: "POST {email, senha}: devolve {token}." },
    { caminho: "/api/auth/sessao", descricao: "GET com Authorization: Bearer <token>: devolve o usuário." },
    { caminho: "/api/auth/logout", descricao: "POST com Authorization: Bearer <token>: encerra a sessão." },
  ],
  arquivosAfetados: [
    "src/lib/auth.ts",
    "src/app/api/auth/registrar/route.ts",
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/sessao/route.ts",
    "src/app/api/auth/logout/route.ts",
  ],
  objetivo:
    "Implementar cadastro, login e sessão por token em Next.js App Router, com dados em memória e sem pacotes externos (só node:crypto).",
  notasImplementacao: [
    "Sem dependências novas: hash com scrypt de node:crypto e sal aleatório; token com randomBytes(32).",
    "Nenhuma resposta pode conter a senha nem o hash.",
  ],
  requisitosIds: ["REQ-001", "REQ-002", "REQ-003", "REQ-004", "REQ-005"],
  requisitos: [
    {
      id: "REQ-001",
      titulo: "Módulo src/lib/auth.ts",
      criterio:
        "Exportar registrarUsuario, autenticar, usuarioDaSessao, encerrarSessao e buscarUsuario(email) que devolve o Usuario guardado ({id, email, senhaHash}) ou null. A senha é guardada só como hash com sal (scrypt de node:crypto), nunca em texto.",
    },
    {
      id: "REQ-002",
      titulo: "POST /api/auth/registrar",
      criterio:
        "Body {email, senha}. E-mail inválido ou senha com menos de 8 caracteres → 400. E-mail já cadastrado → 409. Sucesso → 201 com {id, email}, sem senha nem hash.",
    },
    {
      id: "REQ-003",
      titulo: "POST /api/auth/login",
      criterio:
        "Body {email, senha}. Correto → 200 com {token}, token aleatório de pelo menos 32 caracteres, novo a cada login. Senha errada ou e-mail inexistente → 401 com exatamente a mesma resposta (não revelar se o e-mail existe).",
    },
    {
      id: "REQ-004",
      titulo: "GET /api/auth/sessao",
      criterio:
        "Lê o header Authorization: Bearer <token>. Token válido → 200 com {id, email}, sem senha nem hash. Sem token ou token inválido → 401.",
    },
    {
      id: "REQ-005",
      titulo: "POST /api/auth/logout",
      criterio:
        "Lê o header Authorization: Bearer <token>, encerra a sessão e responde 2xx. Depois disso o token não vale mais (GET /api/auth/sessao → 401).",
    },
  ],
};

/** P4 parte da base com bugs em bench/projetos/p4-base/ (copiada para o projeto antes da execução). */
export const P4_SPEC: SpecFrontmatterInput = {
  titulo: "Correção da API de Tarefas (P4)",
  status: "aguardando_aprovacao",
  data: "2026-10-09",
  stack: ["Next.js", "TypeScript"],
  modulos: [
    {
      id: "mod-api",
      nome: "Correção das Rotas de Tarefas",
      resumo:
        "O projeto já existe. Corrigir dois defeitos nas rotas sem quebrar o que já funciona (inclusive o GET /api/tarefas/[id]).",
      arquivos: ["src/app/api/tarefas/route.ts", "src/app/api/tarefas/[id]/route.ts"],
    },
  ],
  entidades: [
    {
      nome: "Tarefa",
      campos: [
        { nome: "id", tipo: "string" },
        { nome: "titulo", tipo: "string" },
        { nome: "concluida", tipo: "boolean" },
        { nome: "criadaEm", tipo: "string" },
      ],
    },
  ],
  rotas: [
    { caminho: "/api/tarefas", descricao: "GET lista; POST cria (corrigir a validação do titulo)." },
    {
      caminho: "/api/tarefas/[id]",
      descricao: "GET busca por id (já funciona, manter); PATCH (corrigir o 404); DELETE (já funciona, manter).",
    },
  ],
  arquivosAfetados: ["src/app/api/tarefas/route.ts", "src/app/api/tarefas/[id]/route.ts"],
  objetivo:
    "Corrigir dois defeitos relatados num projeto Next.js que já existe, lendo o código atual antes de alterar e preservando todo o comportamento que já funciona.",
  notasImplementacao: [
    "Projeto existente: leia os arquivos atuais (read_file) antes de reescrever; src/lib/tarefas.ts não muda.",
    "O GET /api/tarefas/[id] e o DELETE já funcionam e precisam continuar existindo e funcionando.",
  ],
  requisitosIds: ["REQ-001", "REQ-002", "REQ-003"],
  requisitos: [
    {
      id: "REQ-001",
      titulo: "Defeito 1 — POST /api/tarefas aceita título vazio",
      criterio:
        "Hoje cria tarefa com titulo vazio ou ausente. Corrigir: titulo ausente, não-texto ou vazio após trim → 400; válido → 201 com a tarefa.",
    },
    {
      id: "REQ-002",
      titulo: "Defeito 2 — PATCH /api/tarefas/[id] responde 200 para id inexistente",
      criterio: "Corrigir: id inexistente → 404; id existente continua atualizando e respondendo 2xx com a tarefa.",
    },
    {
      id: "REQ-003",
      titulo: "Preservar o que já funciona",
      criterio:
        "GET /api/tarefas, GET /api/tarefas/[id] (200 com a tarefa, 404 se não existir) e DELETE /api/tarefas/[id] continuam exportados e com o mesmo comportamento.",
    },
  ],
};
