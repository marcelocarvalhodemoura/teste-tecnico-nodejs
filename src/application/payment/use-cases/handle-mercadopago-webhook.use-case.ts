import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '@domain/payment/repositories/payment.repository';
import {
  IPaymentGateway,
  PAYMENT_GATEWAY,
} from '@domain/payment/gateways/payment-gateway.port';
import {
  IPaymentWorkflow,
  PAYMENT_WORKFLOW,
} from '@domain/payment/gateways/payment-workflow.port';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoWebhookDto } from '../dto/payment.schemas';

/**
 * =============================================================================
 * INTEGRAÇÃO (doc §3): Callback / notificação do Mercado Pago.
 * Atualiza status PENDING → PAID ou FAIL com base na resposta do gateway.
 *
 * Segurança: valida payload; consulta a API oficial (não confia só no body).
 * Temporal (doc §4): se habilitado, sinaliza o workflow em vez de atualizar direto.
 * =============================================================================
 */
@Injectable()
export class HandleMercadoPagoWebhookUseCase {
  private readonly logger = new Logger(HandleMercadoPagoWebhookUseCase.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: IPaymentRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
    @Inject(PAYMENT_WORKFLOW)
    private readonly paymentWorkflow: IPaymentWorkflow,
    private readonly config: ConfigService,
  ) {}

  async execute(payload: MercadoPagoWebhookDto) {
    const mpPaymentId = payload.data?.id?.toString();
    if (!mpPaymentId) {
      this.logger.warn('Webhook sem data.id — ignorado');
      return { processed: false, reason: 'missing_payment_id' };
    }

    // Segurança: consulta fonte da verdade no Mercado Pago
    const mpPayment = await this.paymentGateway.getPayment(mpPaymentId);
    const externalReference = mpPayment.externalReference;

    if (!externalReference) {
      this.logger.warn(`Pagamento MP ${mpPaymentId} sem external_reference`);
      return { processed: false, reason: 'missing_external_reference' };
    }

    const payment = await this.paymentRepository.findById(externalReference);
    if (!payment) {
      throw new NotFoundException(
        `Pagamento local ${externalReference} não encontrado para webhook`,
      );
    }

    const approved = mpPayment.status === 'approved';
    const temporalEnabled = this.config.get<boolean>('TEMPORAL_ENABLED', false);

    if (temporalEnabled) {
      await this.paymentWorkflow.signalPaymentResult(
        payment.id,
        approved,
        mpPaymentId,
      );
      return { processed: true, via: 'temporal_signal', paymentId: payment.id };
    }

    payment.applyMercadoPagoResult(mpPaymentId, approved);
    await this.paymentRepository.update(payment);

    this.logger.log(
      `Webhook processado payment=${payment.id} status=${payment.status}`,
    );

    return {
      processed: true,
      via: 'direct_update',
      paymentId: payment.id,
      status: payment.status,
    };
  }
}
