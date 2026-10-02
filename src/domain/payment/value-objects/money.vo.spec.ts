import { Money } from './money.vo';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): Value Object Money / amount
 * =============================================================================
 */
describe('Money Value Object', () => {
  it('deve criar valor a partir de reais', () => {
    const money = Money.fromReais(10.5);
    expect(money.toCents()).toBe(1050);
    expect(money.toReais()).toBe(10.5);
  });

  it('deve rejeitar amount zero ou negativo', () => {
    expect(() => Money.fromReais(0)).toThrow(/positivo/);
    expect(() => Money.fromReais(-1)).toThrow(/positivo/);
  });

  it('deve rejeitar amount acima do limite', () => {
    expect(() => Money.fromReais(1_000_001)).toThrow(/limite máximo/);
  });
});
