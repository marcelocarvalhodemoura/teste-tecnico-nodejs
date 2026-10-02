import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  InvalidPaymentDataError,
  ManualCardStatusUpdateNotAllowedError,
} from '@domain/payment/errors/domain.errors';

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/payment', headers: {}, id: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { statusCode: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('mapeia erro de validação do domínio para 422', () => {
    const { statusCode, body } = run(new InvalidPaymentDataError('CPF inválido'));
    expect(statusCode).toBe(422);
    expect(body).toMatchObject({ code: 'INVALID_PAYMENT_DATA', message: 'CPF inválido' });
  });

  it('mapeia status manual em CREDIT_CARD para 409', () => {
    const { statusCode } = run(new ManualCardStatusUpdateNotAllowedError());
    expect(statusCode).toBe(409);
  });

  it('preserva o status de HttpException', () => {
    const { statusCode } = run(new NotFoundException('não encontrado'));
    expect(statusCode).toBe(404);
  });

  it('responde 500 genérico para erro de infraestrutura sem vazar a mensagem', () => {
    const { statusCode, body } = run(
      new Error('Invalid `prisma.payment.create()` invocation: connection refused'),
    );
    expect(statusCode).toBe(500);
    expect(body.message).toBe('Erro interno do servidor');
    expect(JSON.stringify(body)).not.toContain('prisma');
    expect(body.correlationId).toBe('req-1');
  });
});
