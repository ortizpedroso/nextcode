# ❖ NextCode Engine v5

> **Plataforma Aberta de Orquestração de Agentes Autônomos de Código**

---

## 📐 Visão Geral & Arquitetura

O **NextCode v5** é um orquestrador de desenvolvimento de software desacoplado que opera via **Grafos Direcionados Acíclicos (DAG)**, **Trava de Aprovação de Especificações Canônicas (T1)**, **Quarentena Isolada (.quarantine/)** e **Auditoria Dupla-Lente (Dual-Lens Blind Auditor)**.

```
[ Usuário ] ➔ [ Intake & Triagem ] ➔ [ Spec Canônica ] ➔ [ Approval Lock T1 ] ➔ [ DAG Engine ] ➔ [ Quarentena ] ➔ [ Auditoria Dupla-Lente ] ➔ [ Repositório Local ]
```

---

## 🔒 Governança & Travas (Directives T1-T6)

* **Lock T1 (Spec Approval Lock):** nenhum nó da DAG executa e nenhum código do chat é promovido ao disco sem a Spec Canônica aprovada (botão no modal ou aprovação explícita no chat). A aprovação por texto exige termo inteiro ("aprovo", "pode executar"...), é anulada por negação próxima ("não vou aprovar") e não vale em pergunta.
* **Lock T2 (Strict Files Scope):** o Tipo 1 reprova qualquer arquivo gerado fora do `files_scope` do nó (e escopo vazio); a promoção só copia arquivos do escopo. Na DAG, com mais de um arquivo no escopo, todo bloco de código precisa declarar `// file: caminho` — destino ambíguo ou duplicado é recusado, nunca adivinhado.
* **Lock T3 (WAL Audit Trail):** SQLite em modo WAL; execuções de nós, rejeições de auditoria, falhas de build e todo comando de terminal (executado ou bloqueado) são registrados em `TelemetryLog`. *Limitação conhecida:* a imutabilidade não é imposta pelo banco (sem triggers).
* **Lock T4 (Quarantine Isolation):** todo código gerado vai para `.quarantine/<taskId>`; o conteúdo auditado é exatamente o promovido (sem stubs injetados). Após promover, roda o type-check real do projeto e **desfaz a promoção** se ela introduzir erros novos (erros pré-existentes não reprovam a mudança).
* **Lock T5 (Dual-Lens Blind Audit):** Tipo 1 = checagens mecânicas determinísticas (sintaxe/balanceamento, JSON, Prisma, CSS, Next.js App Router, imports locais, modelos Prisma inexistentes, OWASP/segredos, escopo). Tipo 2 = Auditor Cego LLM, que lê só o Brief e o código (nunca o relatório do worker). Sem veredito válido da Lente Cega (após 2 chamadas) **nada é aprovado**. Timeout da Lente Cega: `BLIND_AUDIT_TIMEOUT_MS` (padrão 30s).
* **Lock T6 (D-RANHO):** no máximo `maxAttempts` (padrão **3**) tentativas automáticas por nó / por pedido no chat. Ao atingir o limite, o nó fica `blocked` (o botão "Executar nó" também respeita isso), os dependentes são bloqueados em cascata e um **relatório de incidente direcionado ao erro** (causa classificada, erro exato, se repetiu, ação recomendada) é publicado no chat. O desbloqueio é humano: "Desbloquear / Re-tentar Etapa".

---

## 🛡️ Segurança Baseline Zero-Trust

* **Autenticação de API Routes (`requireAuth`):** Rotas mutativas (POST/PUT/DELETE) exigem o header `X-Nextcode-Token`. Leituras (GET) são liberadas para a UI local e nunca devolvem segredos em claro; o servidor escuta só em loopback (`127.0.0.1`) por padrão.
* **Proteção Anti-SSRF (`safeFetch`):** Requisições HTTP de saída passam por resolução DNS prévia e bloqueio de IPs privados/reservados (`127.0.0.1`, `169.254.169.254`).
* **Criptografia em Repouso:** Segredos e chaves de provedores (BYOK) são cifrados com **AES-256-GCM** (`enc:v2`) usando `NEXTCODE_MASTER_KEY` (ou `NEXTCODE_MASTER_KEYS` para rotação). Em produção, sem chave mestra o salvamento de segredos é recusado (503); em desenvolvimento a UI avisa que a chave ficaria em texto plano.
* **Guarde Anti-Vazamento (`check:secrets`):** Impedimento mecânico de comitar bancos de dados (`*.db`) ou arquivos `.env`.

---

## 🚀 Comandos Rápidos

```bash
# Instalar dependências e preparar o banco SQLite
npm install
npx prisma db push

# Iniciar o servidor de desenvolvimento
npm run dev

# Servidor de produção (porta livre a partir de PORT, loopback)
npm run build
npm start

# Executar a suíte de testes unitários e de integração (Vitest)
npm test

# Verificar vazamento de segredos/bancos no Git
npm run check:secrets
```
