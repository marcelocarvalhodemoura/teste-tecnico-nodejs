import { randomUUID } from 'crypto';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import { Cpf } from '../value-objects/cpf.vo';
import { Money } from '../value-objects/money.vo';
import {
  InvalidPaymentDataError,
  InvalidStatusTransitionError,
  ManualCardStatusUpdateNotAllowedError,
} from '../errors/domain.errors';

/**
 * =============================================================================
 * ESTRUTURA DO DOMÍNIO DE PAGAMENTO (doc §2)
 * Entidade rica (Clean Architecture — doc §4): regras de negócio no domínio,
 * independente de frameworks (NestJS, Prisma, Mercado Pago).
 *
 * Decisões sênior:
 * - id UUID (não sequencial)
 * - amount via Money (centavos / Decimal)
 * - status: máquina PENDING → PAID|FAIL (finais)
 * - CREDIT_CARD: status só via gateway (não PUT manual)
 * =============================================================================
 */
export interface PaymentProps {
  id: string;
  cpf: Cpf;
  description: string;
  amount: Money;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  /** ID da preferência/checkout no Mercado Pago (CREDIT_CARD). */
  externalId?: string | null;
  /** URL do checkout Mercado Pago para o pagador (CREDIT_CARD). */
  checkoutUrl?: string | null;
  /** ID do pagamento confirmado no Mercado Pago (callback). */
  mercadoPagoPaymentId?: string | null;
  /**
   * Chave de idempotência do cliente (header Idempotency-Key).
   * Evita cobranças duplicadas em retries de rede.
   */
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentInput {
  cpf: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  idempotencyKey?: string;
}

export type StatusUpdateSource = 'manual' | 'gateway';

export class Payment {
  private constructor(private props: PaymentProps) {}

  /**
   * Factory: cria pagamento sempre com status PENDING (doc §3 — PIX e CREDIT_CARD).
   */
  static create(input: CreatePaymentInput): Payment {
    const description = input.description?.trim();
    if (!description || description.length < 3 || description.length > 255) {
      throw new InvalidPaymentDataError('Descrição deve ter entre 3 e 255 caracteres');
    }

    if (!Object.values(PaymentMethod).includes(input.paymentMethod)) {
      throw new InvalidPaymentDataError('Meio de pagamento inválido');
    }

    const now = new Date();
    return new Payment({
      id: randomUUID(),
      cpf: Cpf.create(input.cpf),
      description,
      amount: Money.fromReais(input.amount),
      paymentMethod: input.paymentMethod,
      status: PaymentStatus.PENDING,
      externalId: null,
      checkoutUrl: null,
      mercadoPagoPaymentId: null,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstitui a entidade a partir da persistência (sem revalidar regras de criação). */
  static reconstitute(props: PaymentProps): Payment {
    return new Payment(props);
  }

  get id(): string {
    return this.props.id;
  }

  get cpf(): Cpf {
    return this.props.cpf;
  }

  get description(): string {
    return this.props.description;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get paymentMethod(): PaymentMethod {
    return this.props.paymentMethod;
  }

  get status(): PaymentStatus {
    return this.props.status;
  }

  get externalId(): string | null | undefined {
    return this.props.externalId;
  }

  get checkoutUrl(): string | null | undefined {
    return this.props.checkoutUrl;
  }

  get mercadoPagoPaymentId(): string | null | undefined {
    return this.props.mercadoPagoPaymentId;
  }

  get idempotencyKey(): string | null | undefined {
    return this.props.idempotencyKey;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * PIX (doc §3): apenas registro PENDING — sem integração externa na etapa inicial.
   */
  isPix(): boolean {
    return this.props.paymentMethod === PaymentMethod.PIX;
  }

  /**
   * CREDIT_CARD (doc §3): exige integração com Mercado Pago.
   */
  requiresMercadoPago(): boolean {
    return this.props.paymentMethod === PaymentMethod.CREDIT_CARD;
  }

  isTerminal(): boolean {
    return (
      this.props.status === PaymentStatus.PAID || this.props.status === PaymentStatus.FAIL
    );
  }

  /** Vincula a preferência Mercado Pago criada para este pagamento (CREDIT_CARD). */
  attachCheckout(preferenceId: string, checkoutUrl: string): void {
    if (!preferenceId?.trim() || !checkoutUrl?.trim()) {
      throw new InvalidPaymentDataError('Preferência de checkout inválida');
    }
    this.props.externalId = preferenceId.trim();
    this.props.checkoutUrl = checkoutUrl.trim();
    this.touch();
  }

  /**
   * Atualização de status (doc §1 — PUT /api/payment/{id} e callback Mercado Pago).
   * - source=manual: permitido só para PIX
   * - source=gateway: callback Mercado Pago (CREDIT_CARD)
   * amount/cpf/paymentMethod são imutáveis (nem existem no DTO de update).
   */
  updateStatus(newStatus: PaymentStatus, source: StatusUpdateSource = 'manual'): void {
    if (this.props.status === newStatus) {
      return;
    }

    if (source === 'manual' && this.requiresMercadoPago()) {
      throw new ManualCardStatusUpdateNotAllowedError();
    }

    if (this.props.status !== PaymentStatus.PENDING) {
      throw new InvalidStatusTransitionError(this.props.status, newStatus);
    }

    if (newStatus !== PaymentStatus.PAID && newStatus !== PaymentStatus.FAIL) {
      throw new InvalidStatusTransitionError(this.props.status, newStatus);
    }

    this.props.status = newStatus;
    this.touch();
  }

  /**
   * Callback Mercado Pago (doc §3): atualiza status com base na notificação.
   * Idempotente: se já estiver em estado terminal, não reprocessa.
   */
  applyMercadoPagoResult(mercadoPagoPaymentId: string, approved: boolean): void {
    if (this.isTerminal()) {
      return;
    }
    this.props.mercadoPagoPaymentId = mercadoPagoPaymentId;
    this.updateStatus(approved ? PaymentStatus.PAID : PaymentStatus.FAIL, 'gateway');
  }

  updateDescription(description: string): void {
    const trimmed = description?.trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 255) {
      throw new InvalidPaymentDataError('Descrição deve ter entre 3 e 255 caracteres');
    }
    this.props.description = trimmed;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }

  toPrimitives() {
    return {
      id: this.props.id,
      cpf: this.props.cpf.getValue(),
      description: this.props.description,
      amount: this.props.amount.toReais(),
      paymentMethod: this.props.paymentMethod,
      status: this.props.status,
      externalId: this.props.externalId ?? null,
      checkoutUrl: this.props.checkoutUrl ?? null,
      mercadoPagoPaymentId: this.props.mercadoPagoPaymentId ?? null,
      idempotencyKey: this.props.idempotencyKey ?? null,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}
