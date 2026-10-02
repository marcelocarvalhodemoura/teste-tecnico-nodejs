import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import {
  CreatePreferenceInput,
  CreatePreferenceResult,
  GatewayPaymentOutcome,
  IPaymentGateway,
  MercadoPagoPaymentInfo,
} from '@domain/payment/gateways/payment-gateway.port';

/**
 * Status de pagamento do Mercado Pago → resultado de domínio.
 * Somente approved/rejected/cancelled/refunded/charged_back são finais;
 * pending, in_process, authorized e in_mediation ainda podem virar approved.
 */
export function toGatewayOutcome(status: string | undefined): GatewayPaymentOutcome {
  switch (status) {
    case 'approved':
      return 'APPROVED';
    case 'rejected':
    case 'cancelled':
    case 'refunded':
    case 'charged_back':
      return 'REJECTED';
    default:
      return 'IN_PROGRESS';
  }
}

/**
 * =============================================================================
 * INTEGRAÇÃO (doc §3): API de Preferências do Checkout do Mercado Pago.
 * CREDIT_CARD → cria preferência e aguarda callback para PAID/FAIL.
 *
 * Segurança: token via env; timeouts; não loga access token.
 * Resiliência: X-Idempotency-Key evita preferências duplicadas em retry.
 * Performance: cliente singleton reutilizado.
 * =============================================================================
 */
@Injectable()
export class MercadoPagoGateway implements IPaymentGateway {
  private readonly logger = new Logger(MercadoPagoGateway.name);
  private readonly client: MercadoPagoConfig;
  private readonly preferenceClient: Preference;
  private readonly paymentClient: Payment;
  /** Credenciais TEST-… só funcionam no checkout sandbox. */
  private readonly useSandbox: boolean;

  constructor(private readonly config: ConfigService) {
    const accessToken = this.config.getOrThrow<string>('MERCADOPAGO_ACCESS_TOKEN');
    this.useSandbox = accessToken.startsWith('TEST-');

    this.client = new MercadoPagoConfig({
      accessToken,
      options: {
        timeout: 5_000, // Resiliência: timeout curto (plano sênior)
      },
    });

    this.preferenceClient = new Preference(this.client);
    this.paymentClient = new Payment(this.client);
  }

  async createCheckoutPreference(
    input: CreatePreferenceInput,
  ): Promise<CreatePreferenceResult> {
    const notificationUrl = this.config.get<string>('MERCADOPAGO_NOTIFICATION_URL');
    const idempotencyKey = input.idempotencyKey ?? input.paymentId;

    this.logger.log(`Criando preferência Mercado Pago para paymentId=${input.paymentId}`);

    const result = await this.preferenceClient.create({
      body: {
        items: [
          {
            id: input.paymentId,
            title: input.title,
            quantity: 1,
            unit_price: input.amount,
            currency_id: 'BRL',
          },
        ],
        // external_reference liga o callback ao pagamento local (doc §3)
        external_reference: input.paymentId,
        notification_url: notificationUrl,
        back_urls: {
          success: this.config.get<string>('MERCADOPAGO_BACK_URL_SUCCESS'),
          failure: this.config.get<string>('MERCADOPAGO_BACK_URL_FAILURE'),
          pending: this.config.get<string>('MERCADOPAGO_BACK_URL_PENDING'),
        },
        auto_return: 'approved',
        statement_descriptor: 'PAYMENT API',
      },
      requestOptions: {
        idempotencyKey,
      },
    });

    const checkoutUrl = this.useSandbox ? result.sandbox_init_point : result.init_point;

    if (!result.id || !checkoutUrl) {
      throw new Error('Mercado Pago não retornou preference id / init_point');
    }

    return { preferenceId: result.id, checkoutUrl };
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPaymentInfo> {
    const result = await this.paymentClient.get({ id: paymentId });

    return {
      id: String(result.id),
      outcome: toGatewayOutcome(result.status),
      rawStatus: result.status ?? 'unknown',
      externalReference: result.external_reference ?? null,
    };
  }
}
