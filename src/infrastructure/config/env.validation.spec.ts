import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    MERCADOPAGO_ACCESS_TOKEN: 'TEST-token',
  };

  it('aceita configuração mínima em development', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.TEMPORAL_ENABLED).toBe(false);
  });

  it('exige API_KEY e webhook secret em production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /API_KEY.*MERCADOPAGO_WEBHOOK_SECRET|MERCADOPAGO_WEBHOOK_SECRET.*API_KEY/,
    );
  });

  it('rejeita o placeholder do .env.example como webhook secret em production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        API_KEY: 'prod-api-key-1234567890',
        MERCADOPAGO_WEBHOOK_SECRET: 'your-webhook-secret-here',
      }),
    ).toThrow(/MERCADOPAGO_WEBHOOK_SECRET/);
  });

  it('aceita production com API_KEY e webhook secret', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      API_KEY: 'prod-api-key-1234567890',
      MERCADOPAGO_WEBHOOK_SECRET: 'real-secret',
    });
    expect(env.NODE_ENV).toBe('production');
  });

  it('trata variáveis vazias como ausentes (aplica defaults)', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: '',
      PORT: '',
      MERCADOPAGO_NOTIFICATION_URL: '',
      TEMPORAL_ENABLED: '',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.MERCADOPAGO_NOTIFICATION_URL).toBeUndefined();
    expect(env.TEMPORAL_ENABLED).toBe(false);
  });
});
