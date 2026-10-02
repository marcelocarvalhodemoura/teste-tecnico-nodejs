import { HandleMercadoPagoWebhookUseCase } from './handle-mercadopago-webhook.use-case';
import { ConfigService } from '@nestjs/config';
import { Payment } from '@domain/payment/entities/payment.entity';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';
import { IPaymentRepository } from '@domain/payment/repositories/payment.repository';
import { IPaymentGateway } from '@domain/payment/gateways/payment-gateway.port';
import { IPaymentWorkflow } from '@domain/payment/gateways/payment-workflow.port';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): Callback Mercado Pago (doc §3)
 * =============================================================================
 */
describe('HandleMercadoPagoWebhookUseCase', () => {
  let useCase: HandleMercadoPagoWebhookUseCase;
  let repository: jest.Mocked<IPaymentRepository>;
  let gateway: jest.Mocked<IPaymentGateway>;
  let workflow: jest.Mocked<IPaymentWorkflow>;

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByExternalId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(async (p) => p),
    };
    gateway = {
      createCheckoutPreference: jest.fn(),
      getPayment: jest.fn(),
    };
    workflow = {
      startCreditCardPayment: jest.fn(),
      signalPaymentResult: jest.fn(),
    };

    useCase = new HandleMercadoPagoWebhookUseCase(
      repository,
      gateway,
      workflow,
      { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService,
    );
  });

  it('deve atualizar pagamento para PAID quando aprovado', async () => {
    const payment = Payment.create({
      cpf: '52998224725',
      description: 'Cartão',
      amount: 10,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });

    gateway.getPayment.mockResolvedValue({
      id: '999',
      status: 'approved',
      externalReference: payment.id,
    });
    repository.findById.mockResolvedValue(payment);

    const result = await useCase.execute({
      type: 'payment',
      data: { id: '999' },
    });

    expect(result.processed).toBe(true);
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(repository.update).toHaveBeenCalled();
  });

  it('deve ignorar webhook sem data.id', async () => {
    const result = await useCase.execute({ type: 'payment' });
    expect(result.processed).toBe(false);
  });
});
