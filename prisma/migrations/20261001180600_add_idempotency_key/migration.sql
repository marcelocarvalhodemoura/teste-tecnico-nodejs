-- AlterTable
ALTER TABLE "payments" ADD COLUMN "idempotency_key" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_payments_cpf_created" ON "payments"("cpf", "created_at" DESC);
