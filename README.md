# ❖ NextCode Engine v5

> **Plataforma Aberta de Orquestração de Agentes Autônomos de Código**

---

## 📐 Visão Geral & Arquitetura

O **NextCode v5** é um orquestrador de desenvolvimento de software desacoplado que opera via **Grafos Direcionados Acíclicos (DAG)**, **Trava de Aprovação de Especificações Canônicas (T1)**, **Quarentena Isolada (.quarantine/)** e **Auditoria Dupla-Lente (Dual-Lens Blind Auditor)**.

```
[ Usuário ] ➔ [ Intake & Triagem ] ➔ [ Spec Canônica ] ➔ [ Approval Lock T1 ] ➔ [ DAG Engine ] ➔ [ Quarentena ] ➔ [ Auditoria Dupla-Lente ] ➔ [ Repositório Local ]
```

---

## 🔒 Governança & Travas Imutáveis (Directives T1-T6)

* **Lock T1 (Spec Approval Lock):** Nenhuma alteração de código ou nó da DAG é executado sem que a Spec Canônica esteja com status de APROVADA pelo usuário.
* **Lock T2 (Strict Files Scope):** A execução de cada tarefa é delimitada exclusivamente aos arquivos declarados no `files_scope`.
* **Lock T3 (WAL Audit Trail):** Histórico de execução e logs gravados de forma imutável no banco SQLite WAL.
* **Lock T4 (Quarantine Isolation):** Todo código gerado é isolado em `.quarantine/` para testes e validação determinística.
* **Lock T5 (Dual-Lens Blind Audit):** Auditoria em 2 etapas: Tipo 1 (Linter/Types/Vitest) + Tipo 2 (Auditor Cego LLM).
* **Lock T6 (Rollback & Expurgador):** Exclusão em milissegundos do espaço de quarentena em caso de reprovação auditada.

---

## 🛡️ Segurança Baseline Zero-Trust

* **Autenticação de API Routes (`requireAuth`):** Rotas mutativas e sensíveis exigem o header `X-Nextcode-Token`.
* **Proteção Anti-SSRF (`safeFetch`):** Requisições HTTP de saída passam por resolução DNS prévia e bloqueio de IPs privados/reservados (`127.0.0.1`, `169.254.169.254`).
* **Criptografia em Repouso:** Segredos e chaves de provedores (BYOK) são cifrados com **AES-256-GCM** (`enc:v2`).
* **Guarde Anti-Vazamento (`check:secrets`):** Impedimento mecânico de comitar bancos de dados (`*.db`) ou arquivos `.env`.

---

## 🚀 Comandos Rápidos

```bash
# Instalar dependências e preparar o banco SQLite
npm install
npx prisma db push

# Iniciar o servidor de desenvolvimento
npm run dev

# Executar a suíte de testes unitários e de integração (Vitest)
npm test

# Verificar vazamento de segredos/bancos no Git
npm run check:secrets
```
