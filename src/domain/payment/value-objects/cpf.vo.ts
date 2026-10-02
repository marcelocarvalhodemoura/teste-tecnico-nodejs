import { InvalidPaymentDataError } from '../errors/domain.errors';

/**
 * =============================================================================
 * CONSIDERAÇÃO TÉCNICA (doc §4): Validações para integridade do sistema.
 * Value Object de CPF — encapsula regras de formato e dígitos verificadores.
 * Segurança: evita persistir/processar CPF inválido e reduz risco de fraude.
 * =============================================================================
 */
export class Cpf {
  private readonly value: string;

  private constructor(cpf: string) {
    this.value = cpf;
  }

  static create(raw: string): Cpf {
    const digits = raw.replace(/\D/g, '');

    if (digits.length !== 11) {
      throw new InvalidPaymentDataError('CPF deve conter 11 dígitos');
    }

    if (/^(\d)\1{10}$/.test(digits)) {
      throw new InvalidPaymentDataError('CPF inválido: sequência repetida');
    }

    if (!Cpf.isValidCheckDigits(digits)) {
      throw new InvalidPaymentDataError('CPF inválido: dígitos verificadores incorretos');
    }

    return new Cpf(digits);
  }

  private static isValidCheckDigits(cpf: string): boolean {
    const calcDigit = (base: string, factor: number): number => {
      let sum = 0;
      for (let i = 0; i < base.length; i++) {
        sum += Number(base[i]) * (factor - i);
      }
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };

    const d1 = calcDigit(cpf.slice(0, 9), 10);
    const d2 = calcDigit(cpf.slice(0, 10), 11);
    return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
  }

  getValue(): string {
    return this.value;
  }

  /** Formato mascarado para logs — segurança (LGPD / PII). */
  toMasked(): string {
    return `${this.value.slice(0, 3)}.***.***-${this.value.slice(9)}`;
  }

  equals(other: Cpf): boolean {
    return this.value === other.value;
  }
}
