/**
 * =============================================================================
 * DOMÍNIO DE PAGAMENTO (doc §2)
 * Estados possíveis do ciclo de vida de uma cobrança:
 * - PENDING: Pagamento pendente
 * - PAID: Pagamento aprovado com sucesso
 * - FAIL: Erro no processamento da transação
 * =============================================================================
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAIL = 'FAIL',
}
