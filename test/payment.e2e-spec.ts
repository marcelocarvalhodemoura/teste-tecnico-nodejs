import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { AppModule } from '../src/app.module';
import { PAYMENT_GATEWAY } from '../src/domain/payment/gateways/payment-gateway.port';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '../src/domain/payment/repositories/payment.repository';
import { PaymentStatus } from '../src/domain/payment/enums/payment-status.enum';
import { ConcurrentPaymentUpdateError } from '../src/domain/payment/errors/domain.errors';
import { GlobalExceptionFilter } from '../src/shared/filters/global-exception.filter';

/**
 * =============================================================================
 * E2E com Testcontainers (Postgres real) — plano sênior.
 * Mercado Pago é mockado para não depender de rede externa.
 * =============================================================================
 */
describe('Payment API (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  const apiKey = 'dev-api-key-change-me';

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('payment_db')
      .withUsername('payment_user')
      .withPassword('payment_secret_change_me')
      .start();

    const databaseUrl = postgres.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-e2e-token';
    process.env.TEMPORAL_ENABLED = 'false';
    process.env.API_KEY = apiKey;
    process.env.API_PREFIX = 'api';
    process.env.THROTTLE_LIMIT = '1000';

    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue({
        createCheckoutPreference: jest
          .fn()
          .mockImplementation(async (input: { paymentId: string }) => ({
            preferenceId: `pref-${input.paymentId}`,
            checkoutUrl: 'https://sandbox.mp.example/checkout',
          })),
        getPayment: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it('GET /api/health é público', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });

  it('rejeita POST /api/payment sem API Key', async () => {
    await request(app.getHttpServer())
      .post('/api/payment')
      .send({
        cpf: '52998224725',
        description: 'Sem key',
        amount: 10,
        paymentMethod: 'PIX',
      })
      .expect(401);
  });

  it('cria pagamento PIX autenticado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', 'e2e-pix-1')
      .send({
        cpf: '529.982.247-25',
        description: 'Assinatura e2e',
        amount: 49.9,
        paymentMethod: 'PIX',
      })
      .expect(201);

    expect(res.body.status).toBe('PENDING');
    expect(res.body.paymentMethod).toBe('PIX');
    expect(res.body.id).toBeDefined();
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('replay de Idempotency-Key retorna o mesmo pagamento', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', 'e2e-pix-replay')
      .send({
        cpf: '52998224725',
        description: 'Replay test',
        amount: 20,
        paymentMethod: 'PIX',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', 'e2e-pix-replay')
      .send({
        cpf: '52998224725',
        description: 'Replay test',
        amount: 20,
        paymentMethod: 'PIX',
      })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.idempotentReplay).toBe(true);
  });

  it('lista pagamentos com filtro CPF', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/payment')
      .query({ cpf: '52998224725', paymentMethod: 'PIX' })
      .set('x-api-key', apiKey)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toBeDefined();
  });

  it('CREDIT_CARD cria preferência (gateway mock)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .send({
        cpf: '52998224725',
        description: 'Notebook e2e',
        amount: 1500,
        paymentMethod: 'CREDIT_CARD',
      })
      .expect(201);

    expect(res.body.externalId).toMatch(/^pref-/);
    expect(res.body.checkoutUrl).toContain('sandbox.mp.example');

    // checkoutUrl é persistido: GET devolve o mesmo link
    const fetched = await request(app.getHttpServer())
      .get(`/api/payment/${res.body.id}`)
      .set('x-api-key', apiKey)
      .expect(200);
    expect(fetched.body.checkoutUrl).toBe(res.body.checkoutUrl);
  });

  it('PUT status manual em CREDIT_CARD retorna 409', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .send({
        cpf: '52998224725',
        description: 'Card update forbid',
        amount: 100,
        paymentMethod: 'CREDIT_CARD',
      })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/payment/${created.body.id}`)
      .set('x-api-key', apiKey)
      .send({ status: 'PAID' })
      .expect(409);
  });

  it('escritas concorrentes de status não sobrescrevem uma à outra', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/payment')
      .set('x-api-key', apiKey)
      .send({
        cpf: '52998224725',
        description: 'Corrida de status',
        amount: 30,
        paymentMethod: 'PIX',
      })
      .expect(201);

    const repository = app.get<IPaymentRepository>(PAYMENT_REPOSITORY);
    // Duas operações leem o mesmo estado PENDING…
    const first = await repository.findById(created.body.id);
    const second = await repository.findById(created.body.id);

    first!.updateStatus(PaymentStatus.PAID, 'manual');
    await repository.update(first!);

    // …a segunda não pode transformar PAID em FAIL
    second!.updateStatus(PaymentStatus.FAIL, 'manual');
    await expect(repository.update(second!)).rejects.toBeInstanceOf(
      ConcurrentPaymentUpdateError,
    );

    const final = await repository.findById(created.body.id);
    expect(final!.status).toBe(PaymentStatus.PAID);
  });
});
