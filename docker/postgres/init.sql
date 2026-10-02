-- =============================================================================
-- Performance: índices para filtros frequentes (CPF, payment_method, status).
-- Segurança: extensão pgcrypto disponível para futuras necessidades de hash.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- As tabelas são gerenciadas pelas migrations do Prisma (prisma/migrations).
-- Este script garante extensões e configurações iniciais do banco.
