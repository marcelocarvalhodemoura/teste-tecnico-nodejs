import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  private connection: Connection | null = null;
  /** Conexão em andamento/estabelecida — compartilhada entre requisições. */
  private clientPromise: Promise<Client> | null = null;
  private taskQueue = 'payment-processing';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>('TEMPORAL_ENABLED', false)) {
      this.logger.warn('Temporal desabilitado (TEMPORAL_ENABLED=false)');
      return;
    }

    this.taskQueue = this.config.get<string>('TEMPORAL_TASK_QUEUE', 'payment-processing');

    // Resiliência: API sobe mesmo se Temporal estiver indisponível no boot;
    // a conexão é refeita sob demanda na próxima requisição.
    await this.getClient().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }

  async startCreditCardPayment(
    input: StartCreditCardWorkflowInput,
  ): Promise<{ workflowId: string }> {
    const client = await this.getClient();
    const workflowId = `credit-card-${input.paymentId}`;

    await client.workflow.start('creditCardPaymentWorkflow', {
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
    const client = await this.getClient();
    const handle = client.workflow.getHandle(`credit-card-${paymentId}`);
    await handle.signal(paymentResultSignal, {
      approved,
      mercadoPagoPaymentId,
    });
  }

  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error: unknown) => {
        // Libera nova tentativa na próxima chamada
        this.clientPromise = null;
        this.logger.error(
          'Falha ao conectar no Temporal',
          error instanceof Error ? error.stack : undefined,
        );
        throw new ServiceUnavailableException(
          'Orquestrador de pagamentos (Temporal) indisponível',
        );
      });
    }
    return this.clientPromise;
  }

  private async connect(): Promise<Client> {
    this.connection = await Connection.connect({
      address: this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233'),
    });
    this.logger.log('Cliente Temporal conectado');
    return new Client({
      connection: this.connection,
      namespace: this.config.get<string>('TEMPORAL_NAMESPACE', 'default'),
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
