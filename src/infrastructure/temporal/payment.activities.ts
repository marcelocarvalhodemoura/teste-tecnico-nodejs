/**
 * =============================================================================
 * TEMPORAL ACTIVITIES (doc §4)
 * Side-effects: Mercado Pago + update no PostgreSQL via Prisma.
 * Isoladas do workflow para retry/idempotência.
 * =============================================================================
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import { MercadoPagoGateway } from '../mercadopago/mercadopago.gateway';

let prisma: PrismaClient | null = null;
let gateway: MercadoPagoGateway | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/** Reutiliza o mesmo adapter da API (mesmo payload, back_urls e timeout). */
function getGateway(): MercadoPagoGateway {
  if (!gateway) {
    gateway = new MercadoPagoGateway(new ConfigService(process.env));
  }
  return gateway;
}

export async function createMercadoPagoPreference(input: {
  paymentId: string;
  title: string;
  amount: number;
}): Promise<{ preferenceId: string }> {
  const { preferenceId, checkoutUrl } =
    await getGateway().createCheckoutPreference({
      paymentId: input.paymentId,
      title: input.title,
      amount: input.amount,
      // Idempotência no MP: retries da activity não criam preferências duplicadas
      idempotencyKey: input.paymentId,
    });

  await getPrisma().payment.update({
    where: { id: input.paymentId },
    data: { externalId: preferenceId, checkoutUrl },
  });

  return { preferenceId };
}

export async function updatePaymentStatus(input: {
  paymentId: string;
  status: 'PAID' | 'FAIL';
  mercadoPagoPaymentId: string | null;
}): Promise<void> {
  // Condicional: só finaliza se ainda estiver PENDING (idempotente em retries)
  await getPrisma().payment.updateMany({
    where: { id: input.paymentId, status: PaymentStatus.PENDING },
    data: {
      status: PaymentStatus[input.status],
      mercadoPagoPaymentId: input.mercadoPagoPaymentId,
    },
  });
}
