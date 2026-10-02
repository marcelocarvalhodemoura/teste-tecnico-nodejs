# =============================================================================
# Payment API — Teste Técnico Node.js (NestJS + PostgreSQL + Zod + Temporal)
# =============================================================================

API REST para gestão do ciclo de vida de cobranças financeiras, com suporte a
**PIX** e **Cartão de Crédito** (integração Mercado Pago), seguindo
**Clean Architecture**, validações com **Zod**, testes unitários com **Jest**
e infraestrutura via **Docker**.

> Cada comentário no código referencia as seções do documento do teste
> (`doc §1` … `doc §5`) para rastreabilidade das considerações exigidas.

---

## Requisitos do documento cobertos

| Seção | Item | Implementação |
|-------|------|---------------|
| §1 | `POST /api/payment` | `PaymentController.create` |
| §1 | `PUT /api/payment/{id}` | `PaymentController.update` |
| §1 | `GET /api/payment/{id}` | `PaymentController.findOne` |
| §1 | `GET /api/payment` (filtros CPF / meio) | `PaymentController.findAll` |
| §2 | Domínio (`id`, `cpf`, `description`, `amount`, `paymentMethod`, `status`) | `Payment` entity |
| §3 | PIX → apenas `PENDING` | `CreatePaymentUseCase` |
| §3 | CREDIT_CARD → Preferências Mercado Pago | `MercadoPagoGateway` |
| §3 | Callback / webhook MP | `POST /api/webhooks/mercadopago` |
| §4 | Testes unitários | `*.spec.ts` + Jest |
| §4 | RESTful | Controllers NestJS |
| §4 | Validações | Zod + Value Objects |
| §4 | Clean Architecture | `domain` / `application` / `infrastructure` / `presentation` |
| §4 | Controle de versão | Git (`.gitignore`) |
| §4 | Temporal.io (opcional) | Workflow CREDIT_CARD |
| §5 | NestJS, PostgreSQL (Prisma), Temporal | Docker Compose |

---

## Arquitetura (Clean Architecture)

```
src/
├── domain/           # Entidades, VOs, ports (sem dependência de framework)
├── application/      # Use cases + schemas Zod
├── infrastructure/   # Prisma/Postgres, Mercado Pago, Temporal
├── presentation/     # Controllers HTTP
└── shared/           # Pipes, filters
```

Fluxo CREDIT_CARD com Temporal (`TEMPORAL_ENABLED=true`):

1. API persiste pagamento `PENDING` e inicia o workflow (falha ao iniciar → `FAIL`, HTTP 503)
2. Workflow Temporal cria preferência no Mercado Pago e grava `externalId` + `checkoutUrl`
   (o link fica disponível em `GET /api/payment/{id}`); se o MP falhar após os retries → `FAIL`
3. Webhook sinaliza o workflow (`paymentResult`) apenas com status final
4. Workflow atualiza status para `PAID` ou `FAIL` de forma durável (timeout de 24h → `FAIL`)

Sem Temporal (`TEMPORAL_ENABLED=false`): criação síncrona da preferência (resposta já traz
`checkoutUrl`) + update direto no webhook.

### Webhook Mercado Pago

O webhook nunca confia no body: consulta o pagamento na API do MP e mapeia o status:

| Status MP | Efeito |
|-----------|--------|
| `approved` | `PAID` |
| `rejected`, `cancelled`, `refunded`, `charged_back` | `FAIL` |
| `pending`, `in_process`, `authorized`, `in_mediation` | mantém `PENDING` (aguarda nova notificação) |

Notificações de outro tipo, de pagamento já finalizado ou com referência desconhecida retornam
`200` com `processed: false` (evita reenvio infinito pelo MP). Status são gravados com escrita
condicional (só a partir de `PENDING`), então callbacks concorrentes não sobrescrevem um ao outro.

---

## Pré-requisitos

- Node.js 20+
- Docker & Docker Compose
- Conta Mercado Pago (Access Token de teste)

---

## Subindo o ambiente

```bash
cp .env.example .env
# Preencha ao menos DATABASE_URL e MERCADOPAGO_ACCESS_TOKEN
# (variáveis vazias usam o default; ex.: postgresql://payment_user:payment_secret_change_me@localhost:15432/payment_db?schema=public)

# Infra (Postgres na porta 15432 para não conflitar com Postgres local)
docker compose up -d postgres

# Dependências e API
npm install
npx prisma migrate dev --name init
npm run start:dev

# Worker Temporal (em outro terminal, se TEMPORAL_ENABLED=true)
npm run worker:temporal
```

Ou stack completa (Postgres, Temporal, API e worker):

```bash
docker compose up --build
```

> O compose roda a API com `NODE_ENV=production`, que exige `API_KEY` e
> `MERCADOPAGO_WEBHOOK_SECRET` reais no `.env` (a API não sobe com o placeholder).

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- Temporal UI: http://localhost:8080
- Health: http://localhost:3000/api/health

---

## Exemplos de uso

### Criar pagamento PIX

```bash
curl -X POST http://localhost:3000/api/payment \
  -H 'Content-Type: application/json' \
  -d '{
    "cpf": "529.982.247-25",
    "description": "Assinatura mensal",
    "amount": 99.90,
    "paymentMethod": "PIX"
  }'
```

### Criar pagamento CREDIT_CARD

```bash
curl -X POST http://localhost:3000/api/payment \
  -H 'Content-Type: application/json' \
  -d '{
    "cpf": "529.982.247-25",
    "description": "Compra notebook",
    "amount": 3500.00,
    "paymentMethod": "CREDIT_CARD"
  }'
```

### Listar com filtros

```bash
curl "http://localhost:3000/api/payment?cpf=52998224725&paymentMethod=PIX&page=1&limit=20"
```

### Atualizar status

```bash
curl -X PUT http://localhost:3000/api/payment/{id} \
  -H 'Content-Type: application/json' \
  -d '{ "status": "PAID" }'
```

---

## Testes

```bash
npm run lint:check    # ESLint + Prettier
npm test              # unitários
npm run test:e2e      # e2e com Testcontainers (Docker necessário)
npm run test:temporal # workflow Temporal com time-skipping
npm run test:cov
```

---

## Segurança e performance (nível sênior)

**Segurança**
- Helmet + CORS restrito
- Rate limiting (`@nestjs/throttler`)
- Validação Zod em todas as entradas
- Validação de env no boot
- Assinatura HMAC do webhook (obrigatória em production) + proteção contra replay (`ts`)
- `Idempotency-Key` no POST e no Mercado Pago (mesma chave com payload diferente → 422)
- CPF mascarado em logs; headers sensíveis redacted no Pino
- Container non-root + multi-stage build
- Body size limit (100kb)

**Observabilidade**
- Logs estruturados com `nestjs-pino`
- `x-correlation-id` em toda request (gerado ou propagado)
- Health check com verificação do Postgres (503 quando o banco está fora)

**Performance**
- Índices Prisma em `cpf`, `payment_method`, `status`, `(cpf, created_at)`
- Paginação obrigatória na listagem
- Connection pool do Prisma Client
- Timeout 5s nas chamadas Mercado Pago
- Money em centavos (evita float)

---

## Decisões e trade-offs

| Decisão | Motivo |
|---------|--------|
| **PUT restrito** (não PATCH) | O PDF exige PUT; `cpf`/`amount`/`paymentMethod` são imutáveis; status de CREDIT_CARD só via webhook (409 se tentar manual) |
| **API Key (`x-api-key`)** | Autenticação simples B2B; webhook/health são `@Public()` (HMAC no webhook) |
| **Money / Decimal** | Evita erro de ponto flutuante em valores monetários |
| **UUID** | Impede enumeração de IDs sequenciais |
| **Idempotency-Key** | Retries do cliente e do Mercado Pago não geram cobrança duplicada |
| **Temporal opcional** | `TEMPORAL_ENABLED=false` usa fluxo síncrono; `true` orquestra de forma durável |
| **Prisma migrations** | Schema versionado; sem `synchronize` em produção |

**Próximos passos (opcional):** JWT/OAuth2 para usuários finais, outbox pattern, PIX real com QR Code.

Coleção HTTP: [`http/payment.http`](./http/payment.http). CI: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

---

## Prisma

```bash
npm run prisma:generate          # gera o client
npm run prisma:migrate           # cria/aplica migrations (dev)
npm run prisma:migrate:deploy    # aplica migrations (prod)
npm run prisma:studio            # UI visual das tabelas
```

Schema em `prisma/schema.prisma`. Repositório: `PrismaPaymentRepository`.

---

## Variáveis de ambiente

Veja `.env.example`. Em produção use `prisma migrate deploy` (já no Dockerfile).
