import { Inject, Injectable } from '@nestjs/common';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '@domain/payment/repositories/payment.repository';
import { ListPaymentsDto } from '../dto/payment.schemas';

/**
 * =============================================================================
 * FUNCIONALIDADE (doc §1): Listar Pagamentos — GET /api/payment
 * Filtros: CPF e meio de pagamento (paymentMethod).
 * Performance: paginação + índices no banco (cpf, payment_method).
 * =============================================================================
 */
@Injectable()
export class ListPaymentsUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: IPaymentRepository,
  ) {}

  async execute(filters: ListPaymentsDto) {
    const result = await this.paymentRepository.findMany({
      cpf: filters.cpf,
      paymentMethod: filters.paymentMethod,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    });

    return {
      data: result.data.map((p) => p.toPrimitives()),
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }
}
