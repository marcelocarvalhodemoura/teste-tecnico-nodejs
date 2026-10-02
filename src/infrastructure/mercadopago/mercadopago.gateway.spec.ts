import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoGateway, toGatewayOutcome } from './mercadopago.gateway';

describe('toGatewayOutcome', () => {
  it.each([
    ['approved', 'APPROVED'],
    ['rejected', 'REJECTED'],
    ['cancelled', 'REJECTED'],
    ['refunded', 'REJECTED'],
    ['charged_back', 'REJECTED'],
    ['pending', 'IN_PROGRESS'],
    ['in_process', 'IN_PROGRESS'],
    ['authorized', 'IN_PROGRESS'],
    ['in_mediation', 'IN_PROGRESS'],
    [undefined, 'IN_PROGRESS'],
  ])('status %s → %s', (status, expected) => {
    expect(toGatewayOutcome(status)).toBe(expected);
  });
});

describe('MercadoPagoGateway — erros da API', () => {
  it('converte o JSON de erro do SDK em Error com status e motivo', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const gateway = new MercadoPagoGateway(
      new ConfigService({ MERCADOPAGO_ACCESS_TOKEN: 'TEST-token' }),
    );
    (gateway as unknown as { preferenceClient: { create: jest.Mock } }).preferenceClient =
      {
        create: jest.fn().mockRejectedValue({
          status: 400,
          message: 'auto_return invalid. back_url.success must be defined',
          error: 'invalid_auto_return',
        }),
      };

    await expect(
      gateway.createCheckoutPreference({ paymentId: 'p1', title: 'Teste', amount: 10 }),
    ).rejects.toThrow(
      'Mercado Pago: falha ao criar preferência (status=400): auto_return invalid',
    );
  });
});

describe('MercadoPagoGateway — back_urls', () => {
  const makeGateway = (env: Record<string, string>) => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const gateway = new MercadoPagoGateway(
      new ConfigService({ MERCADOPAGO_ACCESS_TOKEN: 'TEST-token', ...env }),
    );
    const create = jest.fn().mockResolvedValue({
      id: 'pref-1',
      sandbox_init_point: 'https://sandbox.mp/checkout',
    });
    (gateway as unknown as { preferenceClient: { create: jest.Mock } }).preferenceClient =
      {
        create,
      };
    return { gateway, create };
  };

  it('não envia auto_return sem MERCADOPAGO_BACK_URL_SUCCESS', async () => {
    const { gateway, create } = makeGateway({});
    await gateway.createCheckoutPreference({
      paymentId: 'p1',
      title: 'Teste',
      amount: 10,
    });
    const body = create.mock.calls[0][0].body;
    expect(body.auto_return).toBeUndefined();
    expect(body.back_urls).toBeUndefined();
  });

  it('envia back_urls e auto_return quando a URL de sucesso existe', async () => {
    const { gateway, create } = makeGateway({
      MERCADOPAGO_BACK_URL_SUCCESS: 'https://loja.example/sucesso',
    });
    await gateway.createCheckoutPreference({
      paymentId: 'p1',
      title: 'Teste',
      amount: 10,
    });
    const body = create.mock.calls[0][0].body;
    expect(body.auto_return).toBe('approved');
    expect(body.back_urls.success).toBe('https://loja.example/sucesso');
  });
});
