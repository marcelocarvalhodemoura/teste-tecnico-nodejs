/**
 * =============================================================================
 * Erros de domínio tipados — mapeados no ExceptionFilter para 422/409.
 * =============================================================================
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpHint: 422 | 409 = 422,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Dados de pagamento inválidos (CPF, amount, descrição…) — regras dos VOs/entidade.
 */
export class InvalidPaymentDataError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_PAYMENT_DATA', 422);
  }
}

export class InvalidStatusTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `Não é possível alterar status de ${from} para ${to}`,
      'INVALID_STATUS_TRANSITION',
      422,
    );
  }
}

/**
 * CREDIT_CARD: status só muda via callback Mercado Pago (não via PUT manual).
 */
export class ManualCardStatusUpdateNotAllowedError extends DomainError {
  constructor() {
    super(
      'Pagamentos CREDIT_CARD não permitem alteração manual de status. ' +
        'O status é definido pelo callback do Mercado Pago.',
      'MANUAL_CARD_STATUS_FORBIDDEN',
      409,
    );
  }
}

export class ImmutablePaymentFieldError extends DomainError {
  constructor(field: string) {
    super(
      `Campo '${field}' é imutável após a criação do pagamento`,
      'IMMUTABLE_FIELD',
      422,
    );
  }
}
