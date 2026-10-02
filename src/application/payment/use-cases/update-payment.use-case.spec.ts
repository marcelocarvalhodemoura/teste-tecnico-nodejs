import { NotFoundException } from '@nestjs/common';
import { UpdatePaymentUseCase } from './update-payment.use-case';
import { Payment } from '@domain/payment/entities/payment.entity';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';
import { IPaymentRepository } from '@domain/payment/repositories/payment.repository';
import { ManualCardStatusUpdateNotAllowedError } from '@domain/payment/errors/domain.errors';

describe('UpdatePaymentUseCase', () => {
  let useCase: UpdatePaymentUseCase;
  let repository: jest.Mocked<IPaymentRepository>;

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(async (p) => p),
    };
    useCase = new UpdatePaymentUseCase(repository);
  });

  it('deve atualizar status de PIX', async () => {
    const payment = Payment.create({
      cpf: '52998224725',
      description: 'Pix',
      amount: 10,
      paymentMethod: PaymentMethod.PIX,
    });
    repository.findById.mockResolvedValue(payment);

    const result = await useCase.execute(payment.id, {
      status: PaymentStatus.PAID,
    });

    expect(result.status).toBe(PaymentStatus.PAID);
  });

  it('deve rejeitar status manual em CREDIT_CARD', async () => {
    const payment = Payment.create({
      cpf: '52998224725',
      description: 'Cartão',
      amount: 10,
      paymentMethod: PaymentMethod.CREDIT_CARD,
    });
    repository.findById.mockResolvedValue(payment);

    await expect(
      useCase.execute(payment.id, { status: PaymentStatus.PAID }),
    ).rejects.toBeInstanceOf(ManualCardStatusUpdateNotAllowedError);
  });

  it('deve retornar 404 quando não encontrado', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(
      useCase.execute('00000000-0000-0000-0000-000000000001', {
        description: 'x'.repeat(5),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
