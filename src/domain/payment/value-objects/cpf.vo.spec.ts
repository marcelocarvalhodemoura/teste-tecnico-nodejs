import { Cpf } from './cpf.vo';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): Value Object CPF
 * =============================================================================
 */
describe('Cpf Value Object', () => {
  it('deve aceitar CPF válido', () => {
    const cpf = Cpf.create('529.982.247-25');
    expect(cpf.getValue()).toBe('52998224725');
  });

  it('deve rejeitar CPF com dígitos repetidos', () => {
    expect(() => Cpf.create('111.111.111-11')).toThrow(/sequência repetida/);
  });

  it('deve rejeitar CPF com dígitos verificadores inválidos', () => {
    expect(() => Cpf.create('123.456.789-00')).toThrow(/dígitos verificadores/);
  });

  it('deve mascarar CPF para logs (segurança / LGPD)', () => {
    const cpf = Cpf.create('52998224725');
    expect(cpf.toMasked()).toBe('529.***.***-25');
  });
});
