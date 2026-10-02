import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '@domain/payment/repositories/payment.repository';
import { UpdatePaymentDto } from '../dto/payment.schemas';

/**
 * =============================================================================
 * FUNCIONALIDADE (doc §1): Atualizar Pagamento — PUT /api/payment/{id}
 *
 * Regras sênior (alinhadas ao plano de avaliação):
 * - amount, cpf e paymentMethod NÃO mudam (nem existem no DTO)
 * - description pode ser atualizada
 * - status manual só para PIX; CREDIT_CARD só via callback Mercado Pago → 409
 * - Documentamos PUT (exigido no PDF) em vez de PATCH
 * =============================================================================
 */
@Injectable()
export class UpdatePaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: IPaymentRepository,
  ) {}

  async execute(id: string, dto: UpdatePaymentDto) {
    const payment = await this.paymentRepository.findById(id);
    if (!payment) {
      throw new NotFoundException(`Pagamento ${id} não encontrado`);
    }

    // Defesa em profundidade: rejeita campos imutáveis se vazarem no payload
    const forbidden = ['cpf', 'amount', 'paymentMethod', 'id'] as const;
    for (const field of forbidden) {
      if (
        Object.prototype.hasOwnProperty.call(dto as object, field) &&
        (dto as Record<string, unknown>)[field] !== undefined
      ) {
        throw new UnprocessableEntityException(
          `Campo '${field}' é imutável após a criação`,
        );
      }
    }

    if (dto.description !== undefined) {
      payment.updateDescription(dto.description);
    }

    if (dto.status !== undefined) {
      // Domain lança ManualCardStatusUpdateNotAllowedError (409) para CREDIT_CARD
      payment.updateStatus(dto.status, 'manual');
    }

    const updated = await this.paymentRepository.update(payment);
    return updated.toPrimitives();
  }
}
