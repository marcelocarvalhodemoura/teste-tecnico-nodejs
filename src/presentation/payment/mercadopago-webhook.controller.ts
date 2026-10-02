import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { HandleMercadoPagoWebhookUseCase } from '@application/payment/use-cases/handle-mercadopago-webhook.use-case';
import {
  mercadoPagoWebhookSchema,
  MercadoPagoWebhookDto,
} from '@application/payment/dto/payment.schemas';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import { Public } from '@shared/decorators/public.decorator';

/** Janela máxima de replay do webhook (5 minutos). */
const WEBHOOK_MAX_AGE_SECONDS = 300;

/**
 * =============================================================================
 * INTEGRAÇÃO (doc §3): Endpoint de callback/notificação do Mercado Pago.
 * @Public — autenticado via HMAC x-signature (não via API Key).
 * =============================================================================
 */
@ApiTags('webhooks')
@Controller('webhooks/mercadopago')
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(
    private readonly handleWebhook: HandleMercadoPagoWebhookUseCase,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Callback Mercado Pago (doc §3)' })
  @ApiExcludeEndpoint()
  async handle(
    @Body(new ZodValidationPipe(mercadoPagoWebhookSchema))
    body: MercadoPagoWebhookDto,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    this.verifySignature(signature, requestId, body);

    this.logger.log(`Webhook recebido type=${body.type} action=${body.action}`);
    return this.handleWebhook.execute(body);
  }

  private verifySignature(
    signature: string | undefined,
    requestId: string | undefined,
    body: MercadoPagoWebhookDto,
  ): void {
    const secret = this.config.get<string>('MERCADOPAGO_WEBHOOK_SECRET');
    if (!secret || secret === 'your-webhook-secret-here') {
      this.logger.warn(
        'Webhook sem validação de assinatura (secret não configurado)',
      );
      return;
    }

    if (!signature || !requestId || !body.data?.id) {
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }

    const parts = Object.fromEntries(
      signature.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k.trim(), v];
      }),
    );

    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) {
      throw new UnauthorizedException('Cabeçalho x-signature malformado');
    }

    const tsNumber = Number(ts);
    const ageSeconds = Math.abs(Date.now() / 1000 - tsNumber);
    if (!Number.isFinite(tsNumber) || ageSeconds > WEBHOOK_MAX_AGE_SECONDS) {
      throw new UnauthorizedException('Timestamp do webhook expirado (replay)');
    }

    const dataId = String(body.data.id);
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');

    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(v1, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedException('Assinatura do webhook não confere');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Assinatura do webhook não confere');
    }
  }
}
