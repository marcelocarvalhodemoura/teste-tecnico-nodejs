import { z } from 'zod';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';

/**
 * =============================================================================
 * CONSIDERAÇÃO TÉCNICA (doc §4): Validações de entrada com ZOD.
 * CPF, amount, paymentMethod etc. — fundamental para a integridade do sistema.
 * Segurança: rejeita payloads malformados antes de tocar no domínio/banco.
 * =============================================================================
 */

const cpfSchema = z
  .string({ required_error: 'CPF é obrigatório' })
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 11, { message: 'CPF deve conter 11 dígitos' })
  .refine((v) => !/^(\d)\1{10}$/.test(v), {
    message: 'CPF inválido: sequência repetida',
  })
  .refine(
    (v) => {
      const calc = (base: string, factor: number) => {
        let sum = 0;
        for (let i = 0; i < base.length; i++) {
          sum += Number(base[i]) * (factor - i);
        }
        const r = (sum * 10) % 11;
        return r === 10 ? 0 : r;
      };
      return (
        calc(v.slice(0, 9), 10) === Number(v[9]) &&
        calc(v.slice(0, 10), 11) === Number(v[10])
      );
    },
    { message: 'CPF inválido: dígitos verificadores incorretos' },
  );

/**
 * FUNCIONALIDADE (doc §1): POST /api/payment — Adicionar Pagamento
 */
export const createPaymentSchema = z
  .object({
    cpf: cpfSchema,
    description: z
      .string({ required_error: 'Descrição é obrigatória' })
      .trim()
      .min(3, 'Descrição deve ter no mínimo 3 caracteres')
      .max(255, 'Descrição deve ter no máximo 255 caracteres'),
    amount: z
      .number({ required_error: 'Amount é obrigatório' })
      .positive('Amount deve ser positivo')
      .max(1_000_000, 'Amount excede o limite máximo')
      .refine((v) => Number.isFinite(v), { message: 'Amount inválido' }),
    paymentMethod: z.nativeEnum(PaymentMethod, {
      errorMap: () => ({
        message: "paymentMethod deve ser 'PIX' ou 'CREDIT_CARD'",
      }),
    }),
  })
  .strict();

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;

/**
 * FUNCIONALIDADE (doc §1): PUT /api/payment/{id} — Atualizar Pagamento
 * Permite atualização de status (e description opcional).
 */
export const updatePaymentSchema = z
  .object({
    status: z.nativeEnum(PaymentStatus).optional(),
    description: z
      .string()
      .trim()
      .min(3, 'Descrição deve ter no mínimo 3 caracteres')
      .max(255, 'Descrição deve ter no máximo 255 caracteres')
      .optional(),
  })
  .strict()
  .refine((data) => data.status !== undefined || data.description !== undefined, {
    message: 'Informe ao menos status ou description para atualizar',
  });

export type UpdatePaymentDto = z.infer<typeof updatePaymentSchema>;

/**
 * FUNCIONALIDADE (doc §1): GET /api/payment — Listar com filtros (CPF, meio).
 * Performance: paginação obrigatória para evitar full-scan / payloads grandes.
 */
export const listPaymentsSchema = z
  .object({
    cpf: z
      .string()
      .optional()
      .transform((v) => (v ? v.replace(/\D/g, '') : undefined)),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    status: z.nativeEnum(PaymentStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListPaymentsDto = z.infer<typeof listPaymentsSchema>;

export const paymentIdSchema = z
  .string({ required_error: 'ID é obrigatório' })
  .uuid('ID deve ser um UUID válido');

/**
 * Callback / webhook Mercado Pago (doc §3).
 */
export const mercadoPagoWebhookSchema = z.object({
  action: z.string().optional(),
  type: z.string().optional(),
  data: z
    .object({
      id: z.union([z.string(), z.number()]),
    })
    .optional(),
});

export type MercadoPagoWebhookDto = z.infer<typeof mercadoPagoWebhookSchema>;
