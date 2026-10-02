import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
 * - amount, cpf e paymentMethod NÃO mudam (o schema Zod .strict() rejeita com 400)
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
