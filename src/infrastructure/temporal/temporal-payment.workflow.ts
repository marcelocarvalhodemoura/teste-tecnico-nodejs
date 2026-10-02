import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import {
  IPaymentWorkflow,
  StartCreditCardWorkflowInput,
} from '@domain/payment/gateways/payment-workflow.port';
import { paymentResultSignal } from './workflows/credit-card-payment.workflow';

/**
 * =============================================================================
 * TEMPORAL CLIENT ADAPTER (doc §4 — opcional)
 * Inicia workflows CREDIT_CARD e envia signals a partir do webhook.
 * =============================================================================
 */
@Injectable()
export class TemporalPaymentWorkflow
  implements IPaymentWorkflow, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TemporalPaymentWorkflow.name);
  private client: Client | null = null;
  private connection: Connection | null = null;
  private enabled = false;
  private taskQueue = 'payment-processing';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.enabled = this.config.get<boolean>('TEMPORAL_ENABLED', false);
    if (!this.enabled) {
      this.logger.warn('Temporal desabilitado (TEMPORAL_ENABLED=false)');
      return;
    }

    this.taskQueue = this.config.get<string>(
      'TEMPORAL_TASK_QUEUE',
      'payment-processing',
    );

    try {
      this.connection = await Connection.connect({
        address: this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233'),
      });

      this.client = new Client({
        connection: this.connection,
        namespace: this.config.get<string>('TEMPORAL_NAMESPACE', 'default'),
      });

      this.logger.log('Cliente Temporal conectado');
    } catch (error) {
      // Resiliência: API sobe mesmo se Temporal estiver indisponível no boot
      this.logger.error(
        'Falha ao conectar no Temporal — workflows CREDIT_CARD indisponíveis até reconexão',
        error instanceof Error ? error.stack : undefined,
      );
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }

  async startCreditCardPayment(
    input: StartCreditCardWorkflowInput,
  ): Promise<{ workflowId: string }> {
    if (!this.client) {
      throw new Error('Temporal client não inicializado');
    }

    const workflowId = `credit-card-${input.paymentId}`;

    await this.client.workflow.start('creditCardPaymentWorkflow', {
      taskQueue: this.taskQueue,
      workflowId,
      args: [input],
    });

    this.logger.log(`Workflow iniciado: ${workflowId}`);
    return { workflowId };
  }

  async signalPaymentResult(
    paymentId: string,
    approved: boolean,
    mercadoPagoPaymentId: string,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Temporal client não inicializado');
    }

    const handle = this.client.workflow.getHandle(`credit-card-${paymentId}`);
    await handle.signal(paymentResultSignal, {
      approved,
      mercadoPagoPaymentId,
    });
  }
}

/**
 * No-op quando Temporal está desabilitado — permite DI estável.
 */
@Injectable()
export class NoopPaymentWorkflow implements IPaymentWorkflow {
  async startCreditCardPayment(): Promise<{ workflowId: string }> {
    throw new Error(
      'Temporal desabilitado. Configure TEMPORAL_ENABLED=true ou use o fluxo síncrono.',
    );
  }

  async signalPaymentResult(): Promise<void> {
    // no-op
  }
}
