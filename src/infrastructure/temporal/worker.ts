/**
 * =============================================================================
 * TEMPORAL WORKER (doc §4)
 * Processo separado (ou mesmo container) que executa workflows/activities.
 * Rodar: npx ts-node -r tsconfig-paths/register src/infrastructure/temporal/worker.ts
 * =============================================================================
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './payment.activities';

async function run() {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'payment-processing';

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue,
    workflowsPath: require.resolve('./workflows/credit-card-payment.workflow'),
    activities,
  });

  console.log(`Temporal worker iniciado — queue=${taskQueue} address=${address}`);
  await worker.run();
}

run().catch((err) => {
  console.error('Temporal worker falhou', err);
  process.exit(1);
});
