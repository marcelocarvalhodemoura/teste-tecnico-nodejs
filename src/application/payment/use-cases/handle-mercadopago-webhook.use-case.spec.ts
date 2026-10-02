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
  let config: { get: jest.Mock };

  const makeCardPayment = () =>
    Payment.create({
      cpf: '52998224725',
      description: 'Cartão',
      amount: 10,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });

  const mockGatewayPayment = (
    payment: Payment,
    outcome: 'APPROVED' | 'REJECTED' | 'IN_PROGRESS',
    rawStatus: string,
  ) => {
    gateway.getPayment.mockResolvedValue({
      id: '999',
      outcome,
      rawStatus,
      externalReference: payment.id,
    });
    repository.findById.mockResolvedValue(payment);
  };

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

    config = { get: jest.fn().mockReturnValue(false) };

    useCase = new HandleMercadoPagoWebhookUseCase(
      repository,
      gateway,
      workflow,
      config as unknown as ConfigService,
    );
  });

  it('deve atualizar pagamento para PAID quando aprovado', async () => {
    const payment = makeCardPayment();
    mockGatewayPayment(payment, 'APPROVED', 'approved');

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

  it('deve marcar FAIL quando o pagamento é recusado', async () => {
    const payment = makeCardPayment();
    mockGatewayPayment(payment, 'REJECTED', 'rejected');

    await useCase.execute({ type: 'payment', data: { id: '999' } });

    expect(payment.status).toBe(PaymentStatus.FAIL);
  });

  it('deve manter PENDING quando o status ainda está em análise', async () => {
    const payment = makeCardPayment();
    mockGatewayPayment(payment, 'IN_PROGRESS', 'in_process');

    const result = await useCase.execute({
      type: 'payment',
      data: { id: '999' },
    });

    expect(result).toMatchObject({
      processed: false,
      reason: 'non_final_status',
    });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('não deve reprocessar pagamento já finalizado', async () => {
    const payment = makeCardPayment();
    payment.applyMercadoPagoResult('mp-1', true);
    mockGatewayPayment(payment, 'REJECTED', 'refunded');
    config.get.mockReturnValue(true);

    const result = await useCase.execute({
      type: 'payment',
      data: { id: '999' },
    });

    expect(result).toMatchObject({ processed: false, reason: 'already_final' });
    expect(workflow.signalPaymentResult).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.PAID);
  });

  it('deve sinalizar o workflow quando Temporal está habilitado', async () => {
    const payment = makeCardPayment();
    mockGatewayPayment(payment, 'APPROVED', 'approved');
    config.get.mockReturnValue(true);

    const result = await useCase.execute({
      type: 'payment',
      data: { id: '999' },
    });

    expect(result.via).toBe('temporal_signal');
    expect(workflow.signalPaymentResult).toHaveBeenCalledWith(
      payment.id,
      true,
      '999',
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('deve ignorar notificações que não são de pagamento', async () => {
    const result = await useCase.execute({
      type: 'merchant_order',
      data: { id: '123' },
    });

    expect(result).toMatchObject({ processed: false, reason: 'unsupported_type' });
    expect(gateway.getPayment).not.toHaveBeenCalled();
  });

  it('deve ignorar pagamento local inexistente sem lançar erro', async () => {
    gateway.getPayment.mockResolvedValue({
      id: '999',
      outcome: 'APPROVED',
      rawStatus: 'approved',
      externalReference: '00000000-0000-4000-8000-000000000000',
    });
    repository.findById.mockResolvedValue(null);

    const result = await useCase.execute({
      type: 'payment',
      data: { id: '999' },
    });

    expect(result).toMatchObject({ processed: false, reason: 'payment_not_found' });
  });
});
