import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

/**
 * =============================================================================
 * CLEAN ARCHITECTURE (doc §4): Port (interface) do repositório.
 * A camada de domínio define o contrato; a infraestrutura implementa.
 * =============================================================================
 */
export interface PaymentFilters {
  cpf?: string;
  paymentMethod?: PaymentMethod;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface IPaymentRepository {
  save(payment: Payment): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByExternalId(externalId: string): Promise<Payment | null>;
  findByIdempotencyKey(key: string): Promise<Payment | null>;
  findMany(filters: PaymentFilters): Promise<PaginatedResult<Payment>>;
  update(payment: Payment): Promise<Payment>;
}
