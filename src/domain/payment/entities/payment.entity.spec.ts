import { Payment } from './payment.entity';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import { ManualCardStatusUpdateNotAllowedError } from '../errors/domain.errors';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): Entidade Payment + regras de negócio (doc §2/§3)
 * =============================================================================
 */
describe('Payment Entity', () => {
  const validInput = {
    cpf: '52998224725',
    description: 'Cobrança teste',
    amount: 150.75,
    paymentMethod: PaymentMethod.PIX,
  };

  it('deve criar pagamento com status PENDING (doc §2)', () => {
    const payment = Payment.create(validInput);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.id).toBeDefined();
    expect(payment.isPix()).toBe(true);
    expect(payment.requiresMercadoPago()).toBe(false);
  });

  it('CREDIT_CARD deve exigir Mercado Pago (doc §3)', () => {
    const payment = Payment.create({
      ...validInput,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });
    expect(payment.requiresMercadoPago()).toBe(true);
  });

  it('deve permitir transição PENDING → PAID via manual em PIX', () => {
    const payment = Payment.create(validInput);
    payment.updateStatus(PaymentStatus.PAID, 'manual');
    expect(payment.status).toBe(PaymentStatus.PAID);
  });

  it('deve rejeitar alteração manual de status em CREDIT_CARD', () => {
    const payment = Payment.create({
      ...validInput,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });
    expect(() => payment.updateStatus(PaymentStatus.PAID, 'manual')).toThrow(
      ManualCardStatusUpdateNotAllowedError,
    );
  });

  it('deve rejeitar transição a partir de status final', () => {
    const payment = Payment.create(validInput);
    payment.updateStatus(PaymentStatus.PAID, 'manual');
    expect(() => payment.updateStatus(PaymentStatus.FAIL, 'manual')).toThrow(
      /Não é possível alterar status/,
    );
  });

  it('deve aplicar resultado do callback Mercado Pago (doc §3)', () => {
    const payment = Payment.create({
      ...validInput,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });
    payment.applyMercadoPagoResult('mp-123', true);
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.mercadoPagoPaymentId).toBe('mp-123');
  });

  it('callback Mercado Pago deve ser idempotente em status terminal', () => {
    const payment = Payment.create({
      ...validInput,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });
    payment.applyMercadoPagoResult('mp-1', true);
    payment.applyMercadoPagoResult('mp-2', false);
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.mercadoPagoPaymentId).toBe('mp-1');
  });
});
