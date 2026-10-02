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

    // back_urls são opcionais; auto_return só é aceito pelo MP com back_urls.success
    const successUrl = this.config.get<string>('MERCADOPAGO_BACK_URL_SUCCESS');
    const redirect = successUrl
      ? {
          back_urls: {
            success: successUrl,
            failure: this.config.get<string>('MERCADOPAGO_BACK_URL_FAILURE'),
            pending: this.config.get<string>('MERCADOPAGO_BACK_URL_PENDING'),
          },
          auto_return: 'approved',
        }
      : {};

    this.logger.log(`Criando preferência Mercado Pago para paymentId=${input.paymentId}`);

    const result = await this.call('criar preferência', () =>
      this.preferenceClient.create({
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
          ...redirect,
          statement_descriptor: 'PAYMENT API',
        },
        requestOptions: {
          idempotencyKey,
        },
      }),
    );

    const checkoutUrl = this.useSandbox ? result.sandbox_init_point : result.init_point;

    if (!result.id || !checkoutUrl) {
      throw new Error('Mercado Pago não retornou preference id / init_point');
    }

    return { preferenceId: result.id, checkoutUrl };
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPaymentInfo> {
    const result = await this.call('consultar pagamento', () =>
      this.paymentClient.get({ id: paymentId }),
    );

    return {
      id: String(result.id),
      outcome: toGatewayOutcome(result.status),
      rawStatus: result.status ?? 'unknown',
      externalReference: result.external_reference ?? null,
    };
  }

  /**
   * O SDK do Mercado Pago rejeita com o JSON de erro da API (objeto comum, não Error):
   * sem esta conversão o motivo da falha (status, message, cause) se perde nos logs.
   */
  private async call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error) throw error;
      const body = (error ?? {}) as {
        status?: number;
        message?: string;
        error?: string;
        cause?: unknown;
      };
      const detail = body.message ?? body.error ?? 'erro desconhecido';
      const cause = body.cause ? ` cause=${JSON.stringify(body.cause)}` : '';
      throw new Error(
        `Mercado Pago: falha ao ${operation} (status=${body.status ?? '?'}): ${detail}${cause}`,
      );
    }
  }
}
