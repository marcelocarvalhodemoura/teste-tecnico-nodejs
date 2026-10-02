import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PrismaPaymentRepository } from '@infrastructure/database/prisma-payment.repository';
import { MercadoPagoGateway } from '@infrastructure/mercadopago/mercadopago.gateway';
import {
  TemporalPaymentWorkflow,
  NoopPaymentWorkflow,
} from '@infrastructure/temporal/temporal-payment.workflow';
import { PAYMENT_REPOSITORY } from '@domain/payment/repositories/payment.repository';
import { PAYMENT_GATEWAY } from '@domain/payment/gateways/payment-gateway.port';
import { PAYMENT_WORKFLOW } from '@domain/payment/gateways/payment-workflow.port';
import { CreatePaymentUseCase } from '@application/payment/use-cases/create-payment.use-case';
import { UpdatePaymentUseCase } from '@application/payment/use-cases/update-payment.use-case';
import { GetPaymentByIdUseCase } from '@application/payment/use-cases/get-payment-by-id.use-case';
import { ListPaymentsUseCase } from '@application/payment/use-cases/list-payments.use-case';
import { HandleMercadoPagoWebhookUseCase } from '@application/payment/use-cases/handle-mercadopago-webhook.use-case';
import { PaymentController } from '@presentation/payment/payment.controller';
import { MercadoPagoWebhookController } from '@presentation/payment/mercadopago-webhook.controller';
import { HealthController } from '@presentation/health/health.controller';
import { validateEnv } from '@infrastructure/config/env.validation';
import { ApiKeyGuard } from '@shared/guards/api-key.guard';

/**
 * =============================================================================
 * CLEAN ARCHITECTURE + NestJS (doc §4 / §5)
 * Composition root: Domain ← Application ← Infrastructure (Prisma) ← Presentation
 *
 * Segurança: Throttler + validação de env.
 * Observabilidade: nestjs-pino + correlationId.
 * Performance: connection pool Prisma.
 * =============================================================================
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Em test, prioriza process.env (Testcontainers / CI); não carrega .env local
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      envFilePath: ['.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const existing = req.headers['x-correlation-id'];
          const id =
            typeof existing === 'string' && existing.length > 0
              ? existing
              : randomUUID();
          res.setHeader('x-correlation-id', id);
          return id;
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.headers.cookie',
          ],
          remove: true,
        },
        autoLogging: {
          ignore: (req) => (req.url ?? '').includes('/health'),
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),
  ],
  controllers: [
    PaymentController,
    MercadoPagoWebhookController,
    HealthController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    PrismaService,
    {
      provide: PAYMENT_REPOSITORY,
      useClass: PrismaPaymentRepository,
    },
    {
      provide: PAYMENT_GATEWAY,
      useClass: MercadoPagoGateway,
    },
    {
      provide: PAYMENT_WORKFLOW,
      useFactory: (
        config: ConfigService,
        temporal: TemporalPaymentWorkflow,
        noop: NoopPaymentWorkflow,
      ) => {
        // doc §4 — Temporal opcional; fallback síncrono no use case quando false
        return config.get<boolean>('TEMPORAL_ENABLED', false) ? temporal : noop;
      },
      inject: [ConfigService, TemporalPaymentWorkflow, NoopPaymentWorkflow],
    },
    TemporalPaymentWorkflow,
    NoopPaymentWorkflow,
    CreatePaymentUseCase,
    UpdatePaymentUseCase,
    GetPaymentByIdUseCase,
    ListPaymentsUseCase,
    HandleMercadoPagoWebhookUseCase,
  ],
})
export class AppModule {}
