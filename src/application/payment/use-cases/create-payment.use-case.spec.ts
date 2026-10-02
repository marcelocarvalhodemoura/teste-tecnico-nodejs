import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreatePaymentUseCase } from './create-payment.use-case';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';
import { Payment } from '@domain/payment/entities/payment.entity';
import { IPaymentRepository } from '@domain/payment/repositories/payment.repository';
import { IPaymentGateway } from '@domain/payment/gateways/payment-gateway.port';
import { IPaymentWorkflow } from '@domain/payment/gateways/payment-workflow.port';

/**
 * =============================================================================
 * TESTES UNITÁRIOS (doc §4): CreatePaymentUseCase
 * Cobre regras PIX (doc §3), CREDIT_CARD / Mercado Pago (doc §3) e idempotência.
 * =============================================================================
 */
describe('CreatePaymentUseCase', () => {
  let useCase: CreatePaymentUseCase;
  let repository: jest.Mocked<IPaymentRepository>;
  let gateway: jest.Mocked<IPaymentGateway>;
  let workflow: jest.Mocked<IPaymentWorkflow>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;

  const dto = {
    cpf: '52998224725',
    description: 'Cobrança unitária',
    amount: 50,
    paymentMethod: PaymentMethod.PIX as const,
  };

  beforeEach(() => {
    repository = {
      save: jest.fn(async (p: Payment) => p),
      findById: jest.fn(),
      findByExternalId: jest.fn(),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      update: jest.fn(async (p: Payment) => p),
    };

    gateway = {
      createCheckoutPreference: jest.fn(),
      getPayment: jest.fn(),
    };

    workflow = {
      startCreditCardPayment: jest.fn(),
      signalPaymentResult: jest.fn(),
    };

    config = {
      get: jest.fn().mockReturnValue(false),
    };

    useCase = new CreatePaymentUseCase(
      repository,
      gateway,
      workflow,
      config as unknown as ConfigService,
    );
  });

  it('PIX: deve apenas persistir com status PENDING (doc §3)', async () => {
    const result = await useCase.execute(dto);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(gateway.createCheckoutPreference).not.toHaveBeenCalled();
    expect(workflow.startCreditCardPayment).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.paymentMethod).toBe(PaymentMethod.PIX);
    expect(result.checkoutUrl).toBeNull();
  });

  it('deve reutilizar pagamento quando Idempotency-Key já existe', async () => {
    const existing = Payment.create({
      ...dto,
      idempotencyKey: 'key-1',
    });
    repository.findByIdempotencyKey.mockResolvedValue(existing);

    const result = await useCase.execute({
      ...dto,
      idempotencyKey: 'key-1',
    });

    expect(repository.save).not.toHaveBeenCalled();
    expect(result.idempotentReplay).toBe(true);
    expect(result.id).toBe(existing.id);
  });

  it('deve rejeitar Idempotency-Key reutilizada com payload diferente', async () => {
    const existing = Payment.create({ ...dto, idempotencyKey: 'key-1' });
    repository.findByIdempotencyKey.mockResolvedValue(existing);

    await expect(
      useCase.execute({ ...dto, amount: 999, idempotencyKey: 'key-1' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('replay de CREDIT_CARD deve devolver o checkoutUrl persistido', async () => {
    const existing = Payment.create({
      ...dto,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      idempotencyKey: 'key-card',
    });
    existing.attachCheckout('pref-1', 'https://sandbox.mp/checkout');
    repository.findByIdempotencyKey.mockResolvedValue(existing);

    const result = await useCase.execute({
      ...dto,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      idempotencyKey: 'key-card',
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.checkoutUrl).toBe('https://sandbox.mp/checkout');
    expect(gateway.createCheckoutPreference).not.toHaveBeenCalled();
  });

  it('CREDIT_CARD: deve criar preferência no Mercado Pago (doc §3)', async () => {
    gateway.createCheckoutPreference.mockResolvedValue({
      preferenceId: 'pref-1',
      checkoutUrl: 'https://sandbox.mp/checkout',
    });

    const result = await useCase.execute({
      ...dto,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });

    expect(gateway.createCheckoutPreference).toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalled();
    expect(result.externalId).toBe('pref-1');
    expect(result.checkoutUrl).toBe('https://sandbox.mp/checkout');
  });

  it('CREDIT_CARD + Temporal: deve iniciar workflow (doc §4)', async () => {
    config.get.mockReturnValue(true);
    workflow.startCreditCardPayment.mockResolvedValue({
      workflowId: 'credit-card-xyz',
    });

    const result = await useCase.execute({
      ...dto,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });

    expect(workflow.startCreditCardPayment).toHaveBeenCalled();
    expect(gateway.createCheckoutPreference).not.toHaveBeenCalled();
    expect(result.workflowId).toBe('credit-card-xyz');
  });

  it('CREDIT_CARD: falha no gateway deve marcar FAIL', async () => {
    gateway.createCheckoutPreference.mockRejectedValue(new Error('MP down'));

    await expect(
      useCase.execute({
        ...dto,
        paymentMethod: PaymentMethod.CREDIT_CARD,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repository.update).toHaveBeenCalled();
    const updated = repository.update.mock.calls[0][0] as Payment;
    expect(updated.status).toBe(PaymentStatus.FAIL);
  });
});
