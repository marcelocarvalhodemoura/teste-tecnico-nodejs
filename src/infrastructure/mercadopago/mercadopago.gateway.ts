import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import {
  CreatePreferenceInput,
  CreatePreferenceResult,
  IPaymentGateway,
  MercadoPagoPaymentInfo,
} from '@domain/payment/gateways/payment-gateway.port';

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

  constructor(private readonly config: ConfigService) {
    const accessToken = this.config.getOrThrow<string>(
      'MERCADOPAGO_ACCESS_TOKEN',
    );

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
    const notificationUrl = this.config.get<string>(
      'MERCADOPAGO_NOTIFICATION_URL',
    );
    const idempotencyKey = input.idempotencyKey ?? input.paymentId;

    this.logger.log(
      `Criando preferência Mercado Pago para paymentId=${input.paymentId}`,
    );

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

    if (!result.id) {
      throw new Error('Mercado Pago não retornou preference id');
    }

    return {
      preferenceId: result.id,
      initPoint: result.init_point ?? '',
      sandboxInitPoint: result.sandbox_init_point,
    };
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPaymentInfo> {
    const result = await this.paymentClient.get({ id: paymentId });

    return {
      id: String(result.id),
      status: result.status ?? 'unknown',
      externalReference: result.external_reference ?? null,
    };
  }
}
