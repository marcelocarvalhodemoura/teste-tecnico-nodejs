/**
 * =============================================================================
 * TEMPORAL WORKFLOW TESTS (doc §4) — time skipping
 * Testa PAID via signal e FAIL por timeout sem esperar 24h reais.
 * =============================================================================
 */
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  creditCardPaymentWorkflow,
  paymentResultSignal,
} from './credit-card-payment.workflow';

jest.setTimeout(120_000);

describe('creditCardPaymentWorkflow (Temporal time-skipping)', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  const input = {
    paymentId: '11111111-1111-1111-1111-111111111111',
    description: 'Cartão temporal',
    amount: 99.9,
    cpf: '52998224725',
  };

  it('atualiza para PAID quando recebe signal do webhook', async () => {
    const { client, nativeConnection } = testEnv;
    const updatePaymentStatus = jest.fn(async () => undefined);

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: 'test-payment',
      workflowsPath: require.resolve('./credit-card-payment.workflow'),
      activities: {
        createMercadoPagoPreference: async () => ({ preferenceId: 'pref-1' }),
        updatePaymentStatus,
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(creditCardPaymentWorkflow, {
        args: [input],
        workflowId: `wf-paid-${Date.now()}`,
        taskQueue: 'test-payment',
      });

      await handle.signal(paymentResultSignal, {
        approved: true,
        mercadoPagoPaymentId: 'mp-approved-1',
      });

      const result = await handle.result();
      expect(result.status).toBe('PAID');
      expect(result.mercadoPagoPaymentId).toBe('mp-approved-1');
      expect(updatePaymentStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: input.paymentId,
          status: 'PAID',
        }),
      );
    });
  });

  it('atualiza para FAIL quando o timeout de 24h expira (time skip)', async () => {
    const { client, nativeConnection } = testEnv;
    const updatePaymentStatus = jest.fn(async () => undefined);

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: 'test-payment-timeout',
      workflowsPath: require.resolve('./credit-card-payment.workflow'),
      activities: {
        createMercadoPagoPreference: async () => ({ preferenceId: 'pref-2' }),
        updatePaymentStatus,
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(creditCardPaymentWorkflow, {
        args: [{ ...input, paymentId: '22222222-2222-2222-2222-222222222222' }],
        workflowId: `wf-fail-${Date.now()}`,
        taskQueue: 'test-payment-timeout',
      });

      // Avança o relógio durável do Temporal para estourar o condition('24 hours')
      await testEnv.sleep('24 hours');

      const result = await handle.result();
      expect(result.status).toBe('FAIL');
      expect(updatePaymentStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAIL',
        }),
      );
    });
  });
});
