import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '@domain/payment/errors/domain.errors';

/**
 * =============================================================================
 * Segurança / Observabilidade: filtro global de exceções.
 * Mapeamento: domínio → 422/409; HttpException → status próprio;
 * qualquer outro erro → 500 genérico (nunca vaza stack nem mensagem interna).
 * =============================================================================
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const correlationId =
      (request.headers['x-correlation-id'] as string) || request.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Erro interno do servidor';
    let code: string | undefined;

    if (exception instanceof DomainError) {
      status = exception.httpHint;
      message = exception.message;
      code = exception.code;
      this.logger.warn(
        { correlationId, code },
        `DomainError: ${exception.message}`,
      );
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    } else {
      // Falhas de infraestrutura (Prisma, Mercado Pago, Temporal…): 500 genérico,
      // detalhes só no log — nunca na resposta.
      this.logger.error(
        {
          correlationId,
          err: exception instanceof Error ? exception : undefined,
        },
        exception instanceof Error
          ? `Unhandled exception: ${exception.message}`
          : 'Unhandled exception',
      );
    }

    const body =
      typeof message === 'string'
        ? { statusCode: status, message, code, path: request.url }
        : {
            statusCode: status,
            ...(message as object),
            code,
            path: request.url,
          };

    response.status(status).json({
      ...body,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
