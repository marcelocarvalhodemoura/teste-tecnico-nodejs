import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@shared/filters/global-exception.filter';

/**
 * =============================================================================
 * BOOTSTRAP — API REST de cobranças (doc §1–§5)
 *
 * Segurança: Helmet, CORS, rate limit, body limit
 * Observabilidade: nestjs-pino + correlationId (x-correlation-id)
 * Performance: pool Prisma
 * =============================================================================
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const prefix = config.get<string>('API_PREFIX', 'api');
  const corsOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  if (config.get<boolean>('TRUST_PROXY', false)) {
    // Atrás de LB/proxy: usa X-Forwarded-For como IP do cliente (rate limit)
    app.set('trust proxy', 1);
  }

  app.setGlobalPrefix(prefix);
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    exposedHeaders: ['x-correlation-id'],
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useBodyParser('json', { limit: '100kb' });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Payment API')
    .setDescription(
      'API REST para ciclo de vida de cobranças — PIX e Cartão (Mercado Pago). ' +
        'Teste técnico Node.js (Clean Architecture, Zod, Temporal opcional).',
    )
    .setVersion('1.0')
    .addTag('payments')
    .addTag('webhooks')
    .addTag('health')
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port);
  logger.log(`API rodando em http://localhost:${port}/${prefix}`);
  logger.log(`Swagger em http://localhost:${port}/${prefix}/docs`);
}

bootstrap();
