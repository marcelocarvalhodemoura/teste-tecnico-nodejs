import { createPaymentSchema, listPaymentsSchema } from './payment.schemas';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): Validações Zod de entrada
 * =============================================================================
 */
describe('Payment Zod Schemas', () => {
  it('deve validar payload de criação PIX', () => {
    const result = createPaymentSchema.parse({
      cpf: '529.982.247-25',
      description: 'Assinatura mensal',
      amount: 99.9,
      paymentMethod: PaymentMethod.PIX,
    });

    expect(result.cpf).toBe('52998224725');
    expect(result.paymentMethod).toBe(PaymentMethod.PIX);
  });

  it('deve rejeitar paymentMethod inválido', () => {
    expect(() =>
      createPaymentSchema.parse({
        cpf: '52998224725',
        description: 'Teste',
        amount: 10,
        paymentMethod: 'BOLETO',
      }),
    ).toThrow();
  });

  it('deve aplicar defaults de paginação na listagem', () => {
    const result = listPaymentsSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('deve rejeitar amount negativo', () => {
    expect(() =>
      createPaymentSchema.parse({
        cpf: '52998224725',
        description: 'Teste',
        amount: -5,
        paymentMethod: PaymentMethod.PIX,
      }),
    ).toThrow();
  });
});
