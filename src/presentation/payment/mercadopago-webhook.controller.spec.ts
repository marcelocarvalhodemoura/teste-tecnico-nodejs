import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { HandleMercadoPagoWebhookUseCase } from '@application/payment/use-cases/handle-mercadopago-webhook.use-case';

describe('MercadoPagoWebhookController (assinatura HMAC)', () => {
  const secret = 'webhook-secret';
  let execute: jest.Mock;
  let controller: MercadoPagoWebhookController;

  const sign = (dataId: string, requestId: string, ts: number) => {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${v1}`;
  };
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({ processed: true });
    controller = new MercadoPagoWebhookController(
      { execute } as unknown as HandleMercadoPagoWebhookUseCase,
      { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService,
    );
  });

  const body = { type: 'payment', data: { id: '123' } };

  it('aceita assinatura válida', async () => {
    await controller.handle(body, sign('123', 'req-1', now()), 'req-1', '123');
    expect(execute).toHaveBeenCalledWith(body);
  });

  it('usa data.id da query em minúsculas no manifesto', async () => {
    await controller.handle(
      { type: 'payment', data: { id: 'ABC' } },
      sign('abc', 'req-1', now()),
      'req-1',
      'ABC',
    );
    expect(execute).toHaveBeenCalled();
  });

  it('rejeita assinatura que não confere', async () => {
    await expect(
      controller.handle(body, sign('999', 'req-1', now()), 'req-1', '123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejeita timestamp fora da janela (replay)', async () => {
    await expect(
      controller.handle(body, sign('123', 'req-1', now() - 3600), 'req-1', '123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita requisição sem cabeçalhos de assinatura', async () => {
    await expect(
      controller.handle(body, undefined, undefined, '123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
