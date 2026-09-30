# 📋 SPEC CANÔNICA NEXTCODE v5.0
> **Documento Mestre de Especificação Técnica, Governança e Segurança**  
> *Este documento é o padrão oficial obrigatório para a especificação e criação de qualquer sistema ou módulo dentro da plataforma NextCode.*

---

## 🔒 1. DIRECTIVES & MECHANICAL LOCKS [IMUTÁVEL - ENGINE NEXTCODE]

> [!IMPORTANT]
> As travas abaixo são garantidas pela Engine NextCode v5. Nenhuma alteração nesta seção é permitida sem autorização explícita de Engenharia de Sistemas.

- **Lock T1 (Spec Approval):** Nenhuma linha de código pode ser promovida para a branch principal ou diretório final de produção sem o status de validação `APPROVED`.
- **Lock T2 (Strict Files Scope):** A execução é restrita estritamente ao array `files_scope` declarado na seção 5 desta Spec. Edições fora do escopo invalidam a build.
- **Lock T3 (WAL Audit Trail):** Toda instrução, comando executado e log de erro deve ser registrado de forma imutável no banco de dados local SQLite WAL da NextCode.
- **Lock T4 (Quarantine Isolation):** Todo código novo deve ser gerado, executado e testado exclusivamente no diretório isolado `.quarantine/` antes de sua promoção.
- **Lock T5 (Dual-Lens Blind Audit):** O subagente executor e o subagente auditor são instâncias totalmente isoladas. O executor não possui acesso aos testes de validação cega do auditor.
- **Lock T6 (D-RANHO Loop Limit):** Em caso de rejeição pelo auditor, a engine autoriza no máximo **3 tentativas automatizadas de autocorreção** antes de interromper e solicitar intervenção humana.

---

## 🛡️ 2. REQUISITOS OBRIGATÓRIOS DE SEGURANÇA DO SISTEMA [IMUTÁVEL - BASELINE ZERO-TRUST]

> [!CAUTION]
> Todo sistema ou projeto construído pelo NextCode DEVE obrigatoriamente cumprir os 7 Pilares de Segurança abaixo. O descumprimento de qualquer item resulta em rejeição imediata pelo Dual-Lens Blind Auditor.

### 2.1 Autenticação & Gestão de Sessões
- **Mecanismo:** Autenticação via JWT / OAuth2 com assinaturas criptográficas seguras.
- **Invalidação Instantânea:** Toda entidade de usuário DEVE possuir o campo `token_version: Int`. Alterações de credenciais, trocas de senha ou requisições de logout global DEVEM incrementar este valor, invalidando imediatamente todas as sessões ativas.
- **Armazenamento Seguro de Credenciais:** Hash de senhas obrigatoriamente via Argon2id ou bcrypt com salt individual.

### 2.2 Criptografia & Proteção de Dados (PII & Segredos)
- **Dados Sensíveis em Repouso:** Dados pessoais identificáveis (PII como CPF, telefone, documentos), tokens de integração de gateways (Asaas, Stripe) e chaves privadas DEVEM ser gravados no banco usando criptografia **AES-256-GCM** com prefixo `enc:v2`.
- **Zero Secret Exposure:** É estritamente proibido expor variáveis de ambiente do backend (`DATABASE_URL`, `API_KEYS`, `JWT_SECRET`) no código do cliente/frontend (`'use client'` ou prefixos públicos).

### 2.3 Proteção contra Vulnerabilidades OWASP Top 10
- **Sanitização de Entradas (Zod Validation):** 100% das rotas de API DEVEM validar e sanitizar payloads de entrada através de schemas Zod estritos.
- **Prevenção de SQL Injection:** Proibido o uso de queries SQL brutas concatenadas por strings. Todo acesso a dados DEVE utilizar ORM parametrizado (Prisma / Drizzle) ou Prepared Statements.
- **Prevenção de XSS:** Sanitização e escape obrigatórios em qualquer renderização de conteúdo gerado por usuário.
- **Prevenção de SSRF (Server-Side Request Forgery):** Interceptação e bloqueio mecânico de requisições HTTP de saída direcionadas a IPs privados/locais (`127.0.0.1`, `localhost`, `10.0.0.0/8`, `192.168.0.0/16`) ou endpoints de metadados de infraestrutura (`169.254.169.254`).

### 2.4 Controle de Acesso Escopado (RBAC & Multi-Tenant)
- **Validação no Nível de Recurso:** Toda Rota/API de leitura ou escrita DEVE validar se o `userId` autenticado é o legítimo proprietário do registro ou possui permissão explícita no contexto (`WHERE id = resourceId AND tenantId = currentTenantId`).

### 2.5 Proteção contra Abuso & Headers de Segurança
- **Rate Limiting:** Rotas críticas (Login, Cadastro, Recuperação de Senha, Checkout) DEVEM implementar limite de requisições por IP/Usuário.
- **Headers de Segurança:** Configuração obrigatória dos headers `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Strict-Transport-Security`.

---

## 🛡️ 2.1 INCREMENTOS DE SEGURANÇA ESPECÍFICOS DO PROJETO [FLEXÍVEL / EXTENSÍVEL]

> [!NOTE]
> Espaço para regras de segurança adicionais exigidas pelo domínio deste projeto específico (ex: HIPAA para saúde, PCI-DSS para cartões, LGPD estendida, 2FA/MFA obrigatório).

- **[REQUISITO EXTRA DE SEGURANÇA 1]:** *Exemplo: Exigir 2FA (TOTP) para usuários com papel de Administrador.*
- **[REQUISITO EXTRA DE SEGURANÇA 2]:** *Exemplo: Trilha de auditoria imutável para alterações de saldo/crédito.*

---

## ⚙️ 3. CONTEXTO & METADATA DO PROJETO [FLEXÍVEL]

- **Nome do Projeto:** `[Nome do Projeto]`
- **Slug / Identificador:** `[slug-do-projeto]`
- **Caminho Físico de Destino (Local / VPS):** `[c:\projetos\nome-do-projeto ou /var/www/nome-do-projeto]`
- **Gate / Estágio:** `[Gate-1: MVP | Gate-2: Feature Release | Gate-3: Refactoring]`
- **Stack Tecnológica:** `[Next.js 15 / Node.js / Python / Go / PostgreSQL / Prisma / TailwindCSS]`

---

## ⚙️ 4. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO (M1..MN) [FLEXÍVEL]

### Módulo M1: [Nome do Módulo - Ex: Autenticação & Perfil]
- **M1.1:** [Descrição da funcionalidade requerida]
- **M1.2:** [Regra de negócio associada e validações esperadas]

### Módulo M2: [Nome do Módulo - Ex: Processamento de Pagamentos]
- **M2.1:** [Descrição da funcionalidade requerida]
- **M2.2:** [Regra de integração, taxas ou repasses]

---

## ⚙️ 5. DECISÕES DE PRODUTO & FLUXOS DE UX (D1..DN) [FLEXÍVEL]

- **D1 (Jornada do Usuário & Telas):** [Descrição dos fluxos de tela, layouts e interações]
- **D2 (Monetização & Planos):** [Regras de cobrança, assinaturas, gratuidades ou comissões]
- **D3 (Políticas de Exceção):** [Tratamento de cancelamentos, reembolsos ou indisponibilidades]

---

## ⚙️ 6. MODELAGEM DE DADOS & SCHEMAS (PRISMA / DB) [FLEXÍVEL]

```prisma
// Exemplo de esquema Prisma respeitando a segurança imutável (token_version)
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  token_version Int      @default(1) // Requisito imutável de segurança 2.1
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

---

## 🔒 7. MATRIZ DE ARQUIVOS AFETADOS (FILES_SCOPE) [IMUTÁVEL/ESTRITO]

> [!CAUTION]
> Apenas os arquivos declarados abaixo poderão ser criados ou editados pela engine.

```json
{
  "files_scope": [
    "src/app/api/[modulo]/route.ts",
    "src/components/[modulo]/[componente].tsx",
    "prisma/schema.prisma",
    "tests/unit/[modulo].test.ts"
  ]
}
```

---

## 🔒 8. PLANO DE AUDITORIA E VERIFICAÇÃO MECÂNICA [IMUTÁVEL]

### 8.1 Validação Determinística (Tipo 1 - Custo 0 Token)
- **Linter:** `npm run lint` (0 erros permitidos)
- **Checagem de Tipos:** `npx tsc --noEmit` (0 erros de TypeScript)
- **Testes Unitários & Segurança:** `npm run test` (100% de aprovação nas asserções)

### 8.2 Validação de Auditoria Cega (Tipo 2 - Dual-Lens Audit)
- Execução por subagente auditor cego com injeção de casos de teste de segurança e regressão.
- Promoção da Quarentena (`.quarantine/`) para o caminho físico do projeto (`project.path`) liberada **exclusivamente com veredito `APPROVED`**.
