# 📋 SPEC CANÔNICA: Gatway System (Micro-SaaS Embedded Finance & Automação)

**Versão da Spec:** 1.0.0  
**Data:** 2026-09-30  
**Status:** APPROVED  
**Engine Baseline:** NextCode Core v5.0  

---

## 🔒 1. DIRECTIVES & MECHANICAL LOCKS [IMUTÁVEL - ENGINE NEXTCODE]

> [!IMPORTANT]
> As travas mecânicas abaixo são impostas pela Engine NextCode v5 para garantir total integridade no desenvolvimento autônomo.

- **Lock T1 (Spec Approval Lock):** A execução é liberada exclusivamente sob o status `APPROVED`.
- **Lock T2 (Strict Files Scope Lock):** Modificações restritas estritamente ao array `files_scope` declarado na Seção 7.
- **Lock T3 (WAL Audit Trail):** Gravação imutável de todas as chamadas e logs no banco local SQLite WAL.
- **Lock T4 (Quarantine Isolation Lock):** O código novo é desenvolvido e testado primariamente no ambiente isolado `.quarantine/`.
- **Lock T5 (Dual-Lens Blind Audit Lock):** Validação em duas lentes (Tipo 1 Mecânico + Tipo 2 Auditoria Cega Semântica) por subagente independente.
- **Lock T6 (D-RANHO Loop Limit):** Limite estrito de no máximo 3 tentativas automatizadas de autocorreção em caso de rejeição no audit.

---

## 🛡️ 2. REQUISITOS OBRIGATÓRIOS DE SEGURANÇA DO SISTEMA [IMUTÁVEL - BASELINE ZERO-TRUST]

> [!CAUTION]
> O descumprimento de qualquer um dos requisitos de segurança abaixo resulta em reprovação imediata pelo Dual-Lens Blind Auditor.

### 2.1 Autenticação & Gestão de Sessões
- **Autenticação:** Integrada via Supabase Auth + JWT.
- **Invalidação Instantânea:** O modelo `Tenant` / `User` deve conter o campo `token_version: Int`. Troca de senha ou alteração de credenciais exige o incremento deste contador para invalidar sessões ativas imediatamente.
- **Armazenamento de Hash:** Senhas gerenciadas com Argon2id ou bcrypt via Supabase.

### 2.2 Criptografia & Proteção de Dados (PII & Asaas Subaccounts)
- **Criptografia em Repouso (`enc:v2`):** As chaves de API das subcontas filhas do Asaas (`asaasApiKeyEnc`), segredos de webhook e PII de clientes (CPF, CNPJ) DEVEM ser gravados no banco de dados codificados em **AES-256-GCM** com prefixo `enc:v2`.
- **Zero Secret Exposure:** Variáveis de ambiente secretas de backend (`ASAAS_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`) NUNCA podem ser expostas para o frontend.

### 2.3 Proteção contra Vulnerabilidades OWASP Top 10
- **Sanitização de Entradas (Zod Validation):** 100% dos handlers Node.js (`server/`) e endpoints de API devem validar payloads de entrada com schemas Zod.
- **Prevenção de SQL Injection:** Acesso a dados protegido via Supabase Client parametrizado / Prisma ORM com Prepared Statements.
- **Prevenção de SSRF em Webhooks:** Os handlers de webhook do Asaas devem validar obrigatoriamente o header de assinatura `asaas-access-token` e rejeitar conexões provenientes de redes privadas ou locais.

### 2.4 Controle de Acesso Escopado (RBAC & Multi-Tenant)
- **Isolamento de Tenant:** Todas as tabelas de negócio (`Customer`, `Charge`, `Invoice`, `Notification`) DEVEM ter RLS (Row Level Security) ativado no Supabase e filtro `WHERE tenantId = currentTenantId`.

---

## 🛡️ 2.1 INCREMENTOS DE SEGURANÇA ESPECÍFICOS DO GATWAY [FLEXÍVEL / EXTENSÍVEL]

- **Validação de Webhooks Asaas:** Verificação do token de autenticação enviado pelo Asaas no header HTTP.
- **Split & Transfer Security:** Validação de identidade do recebedor (KYC) e limitação de saques para contas bancárias cadastradas sob a mesma titularidade do CNPJ/CPF da subconta.

---

## ⚙️ 3. CONTEXTO & METADATA DO PROJETO [FLEXÍVEL]

- **Nome do Projeto:** Gatway System (Micro-SaaS Embedded Finance & Automação)
- **Slug:** `gatway-system`
- **Caminho Físico de Destino:** `c:\projetos\gatway`
- **Gate:** Gate-1 MVP
- **Stack Tecnológica:** React + Vite, Tailwind CSS, Lucide Icons, Node.js (`server/`), Supabase (PostgreSQL com RLS), API Asaas (Subcontas Whitelabel, Split, Cobranças, Webhooks).

---

## ⚙️ 4. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO (M1..M5) [FLEXÍVEL]

### Módulo M1: Autenticação, Onboarding & Subcontas Asaas (`src/components/auth`, `server/admin-users-handler.mjs`)
- **M1.1:** Cadastro/Login de prestador de serviço via Supabase Auth.
- **M1.2:** Provisionamento automático da subconta filha no Asaas em background via API (`POST /v3/accounts`).
- **M1.3:** Gravação segura da chave de API da subconta com criptografia `enc:v2`.

### Módulo M2: Gestão de Clientes & Catálogo de Serviços
- **M2.1:** Cadastro e edição de clientes com validação em tempo real de CPF/CNPJ.
- **M2.2:** Gestão de catálogo de produtos/serviços com suporte a cobranças avulsas ou assinaturas recorrentes.

### Módulo M3: Motor de Pagamentos, Cobranças & Split (`server/asaas-proxy.mjs`)
- **M3.1:** Emissão de cobranças (Pix dinâmico com QR Code, Boleto Bancário e Cartão de Crédito).
- **M3.2:** Aplicação automática de Split de Pagamento (retenção da taxa SaaS de R$ 99/mês + spread por transação).
- **M3.3:** Gestão de saques e transferências da subconta para o banco do prestador.

### Módulo M4: Automação, Webhooks & Régua WhatsApp (`server/webhook-handler.mjs`)
- **M4.1:** Recepção em tempo real de webhooks Asaas (`PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`).
- **M4.2:** Disparo automático de réguas de cobrança pré e pós vencimento via integração WhatsApp (Z-API / Evolution API).
- **M4.3:** Gatilho automático de emissão de NFS-e (FocusNFe / PlugNotas) ao identificar evento de pagamento confirmado.

### Módulo M5: Painel Financeiro Sem Fricção ("Clique e Veja" para Leigos)
- **M5.1 (UI Sem Jargões Contábeis):** Substituição de termos técnicos (DRE, EBITDA, Conciliação) por cartões de ação clara e intuitiva.
- **M5.2 (Card 1: "Cai Hoje & Este Mês"):** Exibição do valor líquido a receber no dia e no mês corrente, com barra de progresso visual.
- **M5.3 (Card 2: "Inadimplência Ativa & Cobrar por WhatsApp em 1 Clique"):** Tabela simplificada de faturas atrasadas contendo o botão verde de ação direta *"Cobrar por WhatsApp"*, enviando a chave Pix direto para o cliente devedor.
- **M5.4 (Card 3: "Saldo Disponível & Saque Instantâneo"):** Card que exibe o saldo disponível no Asaas com botão de um clique para realizar o saque para a conta bancária cadastrada.
- **M5.5 (Card 4: "Resumo Transparente de Tarifas"):** Detalhamento de taxas operacionais sem surpresas ou termos obscuros.
- **M5.6 (Interatividade "Clique e Veja"):** Clicar em qualquer card de valor abre um Drawer/Modal lateral trazendo o detalhamento dos clientes daquela categoria sem recarregar a página.

---

## ⚙️ 5. DECISÕES DE PRODUTO & FLUXOS DE UX (D1..D4) [FLEXÍVEL]

- **D1 (Modelo Híbrido de Monetização):** Assinatura fixa R$ 99/mês + Spread de 1.5% sobre o valor de Pix/Boleto pago.
- **D2 (UX para Leigos):** Uso de ícones expressivos (Lucide Icons), cores de estado intuitivas (Verde = Recebido, Amarelo = Pendente, Vermelho = Atrasado), e busca instantânea.
- **D3 (Régua Ativa WhatsApp):** Lembretes automáticos (3 dias antes, no dia do vencimento, e 2 dias após com link Pix de cópia e cola).
- **D4 (Zero Fricção no Fiscal):** Emissão de Nota Fiscal ocorre automaticamente sem o usuário precisar preencher formulários adicionais.

---

## ⚙️ 6. MODELAGEM DE DADOS & SCHEMAS (SUPABASE / PRISMA) [FLEXÍVEL]

```prisma
model Tenant {
  id               String   @id @default(uuid())
  name             String
  document         String   // CPF/CNPJ
  asaasAccountId   String?
  asaasApiKeyEnc   String?  // enc:v2 AES-256-GCM
  token_version    Int      @default(1) // Requisito imutável de segurança 2.1
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Customer {
  id         String   @id @default(uuid())
  tenantId   String
  name       String
  cpfCnpj    String
  email      String
  phone      String
  createdAt  DateTime @default(now())
}

model Charge {
  id            String    @id @default(uuid())
  tenantId      String
  customerId    String
  asaasId       String    @unique
  value         Float
  netValue      Float
  status        String    // PENDING, RECEIVED, OVERDUE, REFUNDED
  billingType   String    // PIX, BOLETO, CREDIT_CARD
  dueDate       DateTime
  paymentDate   DateTime?
  createdAt     DateTime  @default(now())
}
```

---

## 🔒 7. MATRIZ DE ARQUIVOS AFETADOS (FILES_SCOPE) [IMUTÁVEL/ESTRITO]

```json
{
  "files_scope": [
    "server/asaas-proxy.mjs",
    "server/webhook-handler.mjs",
    "src/components/financial/FinancialDashboard.tsx",
    "src/components/financial/ReceivablesList.tsx",
    "src/components/financial/QuickChargeModal.tsx",
    "prisma/schema.prisma",
    "tests/financial/financial-module.test.ts"
  ]
}
```

---

## 🔒 8. PLANO DE AUDITORIA E VERIFICAÇÃO MECÂNICA [IMUTÁVEL]

1. **Validação Tipo 1 (Determinística - Custo 0):** `npm run lint`, `npx tsc --noEmit` e suíte `vitest` do módulo financeiro.
2. **Validação Tipo 2 (Dual-Lens Audit):** Avaliação cega em quarentena `.quarantine/` verificando ausência de vazamentos de segredos e conformidade da UX sem fricção.
