import { InvalidPaymentDataError } from '../errors/domain.errors';

/**
 * =============================================================================
 * CONSIDERAÇÃO TÉCNICA (doc §4): Validações de amount para integridade.
 * Value Object monetário — valores em centavos (inteiro) evitam erros de float.
 * Performance: aritmética inteira é previsível e rápida.
 * =============================================================================
 */
export class Money {
  /** Valor armazenado em centavos (ex.: R$ 10,50 → 1050). */
  private readonly amountInCents: number;

  private constructor(amountInCents: number) {
    this.amountInCents = amountInCents;
  }

  /**
   * @param amount Valor em reais (pode ser decimal, ex.: 10.5)
   */
  static fromReais(amount: number): Money {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvalidPaymentDataError('Valor (amount) deve ser um número positivo');
    }

    // Limite defensivo contra overflow / abuso (R$ 1.000.000)
    if (amount > 1_000_000) {
      throw new InvalidPaymentDataError(
        'Valor (amount) excede o limite máximo permitido',
      );
    }

    const cents = Math.round(amount * 100);
    if (cents <= 0) {
      throw new InvalidPaymentDataError('Valor (amount) deve ser maior que zero');
    }

    return new Money(cents);
  }

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents) || cents <= 0) {
      throw new InvalidPaymentDataError('Valor em centavos deve ser um inteiro positivo');
    }
    return new Money(cents);
  }

  toReais(): number {
    return this.amountInCents / 100;
  }

  toCents(): number {
    return this.amountInCents;
  }

  equals(other: Money): boolean {
    return this.amountInCents === other.amountInCents;
  }
}
