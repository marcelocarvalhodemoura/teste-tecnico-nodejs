import {
  Inject,
  Injectable,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment } from '@domain/payment/entities/payment.entity';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';
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
import { CreatePaymentDto } from '../dto/payment.schemas';

export interface CreatePaymentCommand extends CreatePaymentDto {
  /** Header Idempotency-Key — retries seguros do cliente. */
  idempotencyKey?: string;
}

/**
 * =============================================================================
 * FUNCIONALIDADE (doc §1): Adicionar Pagamento — POST /api/payment
 *
 * REGRAS DE NEGÓCIO (doc §3):
 * - PIX: cria registro PENDING no banco — sem integração externa na etapa inicial.
 * - CREDIT_CARD: integra com API de Preferências do Mercado Pago.
 *
 * CONSIDERAÇÃO (doc §4 — Temporal.io opcional):
 * Quando TEMPORAL_ENABLED=true, CREDIT_CARD é orquestrado via workflow durável.
 *
 * Idempotência: se Idempotency-Key já existir, retorna o pagamento original.
 * =============================================================================
 */
@Injectable()
export class CreatePaymentUseCase {
  private readonly logger = new Logger(CreatePaymentUseCase.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: IPaymentRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
    @Inject(PAYMENT_WORKFLOW)
    private readonly paymentWorkflow: IPaymentWorkflow,
    private readonly config: ConfigService,
  ) {}

  async execute(dto: CreatePaymentCommand) {
    if (dto.idempotencyKey) {
      const existing = await this.paymentRepository.findByIdempotencyKey(
        dto.idempotencyKey,
      );
      if (existing) {
        this.logger.log(
          `Idempotency hit key=${dto.idempotencyKey} payment=${existing.id}`,
        );
        return {
          ...existing.toPrimitives(),
          checkoutUrl: null,
          workflowId: null,
          idempotentReplay: true,
        };
      }
    }

    const payment = Payment.create({
      cpf: dto.cpf,
      description: dto.description,
      amount: dto.amount,
      paymentMethod: dto.paymentMethod,
      idempotencyKey: dto.idempotencyKey,
    });

    // Persistência inicial sempre PENDING (doc §2 / §3)
    let saved: Payment;
    try {
      saved = await this.paymentRepository.save(payment);
    } catch (error) {
      // Corrida: mesma Idempotency-Key em paralelo
      if (dto.idempotencyKey) {
        const existing = await this.paymentRepository.findByIdempotencyKey(
          dto.idempotencyKey,
        );
        if (existing) {
          return {
            ...existing.toPrimitives(),
            checkoutUrl: null,
            workflowId: null,
            idempotentReplay: true,
          };
        }
      }
      throw error;
    }

    this.logger.log(
      `Pagamento criado id=${saved.id} method=${saved.paymentMethod} cpf=${saved.cpf.toMasked()}`,
    );

    if (saved.paymentMethod === PaymentMethod.PIX) {
      // doc §3 — PIX: apenas registro PENDING
      return {
        ...saved.toPrimitives(),
        checkoutUrl: null,
        workflowId: null,
        idempotentReplay: false,
      };
    }

    // -------------------------------------------------------------------------
    // doc §3 — CREDIT_CARD: integração obrigatória com Mercado Pago
    // -------------------------------------------------------------------------
    const temporalEnabled = this.config.get<boolean>('TEMPORAL_ENABLED', false);

    if (temporalEnabled) {
      // doc §4 — Temporal: workflow registra PENDING, chama MP e aguarda resultado
      const { workflowId } = await this.paymentWorkflow.startCreditCardPayment({
        paymentId: saved.id,
        description: saved.description,
        amount: saved.amount.toReais(),
        cpf: saved.cpf.getValue(),
      });

      return {
        ...saved.toPrimitives(),
        checkoutUrl: null,
        workflowId,
        idempotentReplay: false,
        message:
          'Pagamento CREDIT_CARD iniciado via Temporal workflow. Aguardando checkout/callback.',
      };
    }

    // Fallback síncrono (sem Temporal): cria preferência e anexa externalId
    try {
      const preference = await this.paymentGateway.createCheckoutPreference({
        paymentId: saved.id,
        title: saved.description,
        amount: saved.amount.toReais(),
        // Idempotency-Key no MP = id do pagamento (ou a do cliente)
        idempotencyKey: saved.idempotencyKey ?? saved.id,
      });

      saved.attachExternalId(preference.preferenceId);
      const updated = await this.paymentRepository.update(saved);

      return {
        ...updated.toPrimitives(),
        checkoutUrl:
          preference.sandboxInitPoint ?? preference.initPoint ?? null,
        workflowId: null,
        idempotentReplay: false,
      };
    } catch (error) {
      this.logger.error(
        `Falha ao criar preferência Mercado Pago para payment=${saved.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      // source=gateway: permite marcar FAIL mesmo sendo CREDIT_CARD
      saved.updateStatus(PaymentStatus.FAIL, 'gateway');
      await this.paymentRepository.update(saved);
      throw new ConflictException(
        'Falha ao iniciar checkout no Mercado Pago. Pagamento marcado como FAIL.',
      );
    }
  }
}
