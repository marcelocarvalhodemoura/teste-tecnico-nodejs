/**
 * =============================================================================
 * TEMPORAL ACTIVITIES (doc §4)
 * Side-effects: Mercado Pago + update no PostgreSQL via Prisma.
 * Isoladas do workflow para retry/idempotência.
 * =============================================================================
 */
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { PrismaClient, PaymentStatus } from '@prisma/client';

let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function createMercadoPagoPreference(input: {
  paymentId: string;
  title: string;
  amount: number;
}): Promise<{ preferenceId: string }> {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado');
  }

  const client = new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10_000 },
  });
  const preferenceClient = new Preference(client);

  const result = await preferenceClient.create({
    body: {
      items: [
        {
          id: input.paymentId,
          title: input.title,
          quantity: 1,
          unit_price: input.amount,
          currency_id: 'BRL',
        },
      ],
      external_reference: input.paymentId,
      notification_url: process.env.MERCADOPAGO_NOTIFICATION_URL,
      back_urls: {
        success: process.env.MERCADOPAGO_BACK_URL_SUCCESS,
        failure: process.env.MERCADOPAGO_BACK_URL_FAILURE,
        pending: process.env.MERCADOPAGO_BACK_URL_PENDING,
      },
      auto_return: 'approved',
    },
    requestOptions: {
      idempotencyKey: input.paymentId,
    },
  });

  if (!result.id) {
    throw new Error('Preferência Mercado Pago sem id');
  }

  await getPrisma().payment.update({
    where: { id: input.paymentId },
    data: { externalId: result.id },
  });

  return { preferenceId: result.id };
}

export async function updatePaymentStatus(input: {
  paymentId: string;
  status: 'PAID' | 'FAIL';
  mercadoPagoPaymentId: string | null;
}): Promise<void> {
  await getPrisma().payment.update({
    where: { id: input.paymentId },
    data: {
      status: PaymentStatus[input.status],
      mercadoPagoPaymentId: input.mercadoPagoPaymentId,
    },
  });
}
