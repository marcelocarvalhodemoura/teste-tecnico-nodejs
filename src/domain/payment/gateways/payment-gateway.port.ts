/**
 * =============================================================================
 * CLEAN ARCHITECTURE (doc §3 / §4): Port de integração com gateway de pagamento.
 * Implementação concreta: Mercado Pago Preferences API (Checkout).
 * =============================================================================
 */
export interface CreatePreferenceInput {
  paymentId: string;
  title: string;
  amount: number;
  payerEmail?: string;
  /** Enviado como X-Idempotency-Key na API do Mercado Pago. */
  idempotencyKey?: string;
}

export interface CreatePreferenceResult {
  preferenceId: string;
  initPoint: string;
  sandboxInitPoint?: string;
}

/**
 * Resultado normalizado do pagamento no gateway (independente do Mercado Pago).
 * - APPROVED: pagamento confirmado → PAID
 * - REJECTED: recusado/cancelado → FAIL
 * - IN_PROGRESS: ainda em análise (pending, in_process, authorized…) → mantém PENDING
 */
export type GatewayPaymentOutcome = 'APPROVED' | 'REJECTED' | 'IN_PROGRESS';

export interface MercadoPagoPaymentInfo {
  id: string;
  outcome: GatewayPaymentOutcome;
  /** Status bruto retornado pelo gateway (para logs/diagnóstico). */
  rawStatus: string;
  externalReference: string | null;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface IPaymentGateway {
  createCheckoutPreference(
    input: CreatePreferenceInput,
  ): Promise<CreatePreferenceResult>;

  getPayment(paymentId: string): Promise<MercadoPagoPaymentInfo>;
}
