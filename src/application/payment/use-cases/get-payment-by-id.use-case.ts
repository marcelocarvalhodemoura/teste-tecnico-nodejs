import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '@domain/payment/repositories/payment.repository';

/**
 * =============================================================================
 * FUNCIONALIDADE (doc §1): Buscar Pagamento por ID — GET /api/payment/{id}
 * Retorna os detalhes de um pagamento específico.
 * =============================================================================
 */
@Injectable()
export class GetPaymentByIdUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: IPaymentRepository,
  ) {}

  async execute(id: string) {
    const payment = await this.paymentRepository.findById(id);
    if (!payment) {
      throw new NotFoundException(`Pagamento ${id} não encontrado`);
    }
    return payment.toPrimitives();
  }
}
