/**
 * =============================================================================
 * TEMPORAL.IO (doc §4 — opcional): Port para orquestração durável.
 * Workflow: PENDING → Mercado Pago → aguarda callback/polling → PAID|FAIL.
 * =============================================================================
 */
export interface StartCreditCardWorkflowInput {
  paymentId: string;
  description: string;
  amount: number;
  cpf: string;
}

export const PAYMENT_WORKFLOW = Symbol('PAYMENT_WORKFLOW');

export interface IPaymentWorkflow {
  startCreditCardPayment(
    input: StartCreditCardWorkflowInput,
  ): Promise<{ workflowId: string }>;

  signalPaymentResult(
    paymentId: string,
    approved: boolean,
    mercadoPagoPaymentId: string,
  ): Promise<void>;
}
