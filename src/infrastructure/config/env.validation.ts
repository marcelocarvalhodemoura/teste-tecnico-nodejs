import { z } from 'zod';

/**
 * =============================================================================
 * Segurança: validação estrita de variáveis de ambiente no boot.
 * A aplicação não sobe com config inválida / secrets ausentes.
 * =============================================================================
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().default('api'),

    /** Connection string usada pelo Prisma (obrigatória). */
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().positive().default(5432).optional(),
    DB_USERNAME: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_DATABASE: z.string().min(1).optional(),
    DB_SSL: z
      .string()
      .transform((v) => v === 'true')
      .default('false')
      .optional(),

    MERCADOPAGO_ACCESS_TOKEN: z.string().min(1),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
    MERCADOPAGO_NOTIFICATION_URL: z.string().url().optional(),
    MERCADOPAGO_BACK_URL_SUCCESS: z.string().url().optional(),
    MERCADOPAGO_BACK_URL_FAILURE: z.string().url().optional(),
    MERCADOPAGO_BACK_URL_PENDING: z.string().url().optional(),

    TEMPORAL_ENABLED: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),
    TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().default('default'),
    TEMPORAL_TASK_QUEUE: z.string().default('payment-processing'),

    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    /** true quando atrás de load balancer/proxy reverso (IP real para o rate limit). */
    TRUST_PROXY: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),

    /**
     * API Key (header x-api-key).
     * Obrigatória em production; opcional em development/test (se vazia, guard libera).
     */
    API_KEY: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(16).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && !data.API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_KEY'],
        message: 'API_KEY é obrigatória em production',
      });
    }
    const secret = data.MERCADOPAGO_WEBHOOK_SECRET?.trim();
    if (
      data.NODE_ENV === 'production' &&
      (!secret || secret === 'your-webhook-secret-here')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MERCADOPAGO_WEBHOOK_SECRET'],
        message:
          'MERCADOPAGO_WEBHOOK_SECRET é obrigatória em production (assinatura do webhook)',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new Error(`Configuração de ambiente inválida: ${details}`);
  }
  return parsed.data;
}
