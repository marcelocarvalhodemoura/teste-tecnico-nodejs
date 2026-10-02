-- =============================================================================
-- Performance: índices para filtros frequentes (CPF, payment_method, status).
-- Segurança: extensão pgcrypto disponível para futuras necessidades de hash.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A tabela será gerenciada pelo TypeORM (synchronize em dev / migrations em prod).
-- Este script garante extensões e configurações iniciais do banco.
