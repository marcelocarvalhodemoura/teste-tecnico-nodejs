/**
 * =============================================================================
 * DOMÍNIO DE PAGAMENTO (doc §2)
 * Meio de pagamento suportado pela API.
 * PIX  → registro local com status PENDING (sem integração externa na etapa inicial)
 * CREDIT_CARD → integração obrigatória com Mercado Pago (doc §3)
 * =============================================================================
 */
export enum PaymentMethod {
  PIX = 'PIX',
  CREDIT_CARD = 'CREDIT_CARD',
}
