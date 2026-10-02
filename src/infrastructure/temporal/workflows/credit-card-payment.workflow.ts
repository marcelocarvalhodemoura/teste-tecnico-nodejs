/**
 * =============================================================================
 * TEMPORAL.IO WORKFLOW (doc §4 — opcional)
 *
 * Espinha dorsal para CREDIT_CARD:
 * 1. Registrar pagamento PENDING (já feito antes do start)
 * 2. Chamar Mercado Pago para criar a transação (preferência)
 * 3. Aguardar retorno (callback/signal ou polling) de forma DURÁVEL
 * 4. Atualizar status para PAID ou FAIL
 *
 * Se o servidor cair, o workflow continua de onde parou.
 * =============================================================================
 */
import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow';
import type * as activities from '../payment.activities';

const { createMercadoPagoPreference, updatePaymentStatus } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/** Signal recebido pelo webhook quando o Mercado Pago notifica o resultado. */
export const paymentResultSignal = defineSignal<
  [{ approved: boolean; mercadoPagoPaymentId: string }]
>('paymentResult');

export interface CreditCardWorkflowInput {
  paymentId: string;
  description: string;
  amount: number;
  cpf: string;
}

export async function creditCardPaymentWorkflow(
  input: CreditCardWorkflowInput,
): Promise<{ status: 'PAID' | 'FAIL'; mercadoPagoPaymentId?: string }> {
  let approved: boolean | null = null;
  let mercadoPagoPaymentId: string | undefined;

  setHandler(paymentResultSignal, (payload) => {
    approved = payload.approved;
    mercadoPagoPaymentId = payload.mercadoPagoPaymentId;
  });

  // Passo 2 (doc §4): chamar serviço de integração Mercado Pago
  await createMercadoPagoPreference({
    paymentId: input.paymentId,
    title: input.description,
    amount: input.amount,
  });

  // Passo 3 (doc §4): aguardar retorno de forma durável (até 24h)
  const received = await condition(() => approved !== null, '24 hours');

  if (!received || approved === null) {
    await updatePaymentStatus({
      paymentId: input.paymentId,
      status: 'FAIL',
      mercadoPagoPaymentId: mercadoPagoPaymentId ?? null,
    });
    return { status: 'FAIL' };
  }

  // Passo 4 (doc §4): atualizar PAID ou FAIL
  const status = approved ? 'PAID' : 'FAIL';
  await updatePaymentStatus({
    paymentId: input.paymentId,
    status,
    mercadoPagoPaymentId: mercadoPagoPaymentId ?? null,
  });

  return { status, mercadoPagoPaymentId };
}
