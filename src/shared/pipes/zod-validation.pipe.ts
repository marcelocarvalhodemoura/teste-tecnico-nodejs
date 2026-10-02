import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * =============================================================================
 * CONSIDERAÇÃO TÉCNICA (doc §4): Validações de entrada com ZOD.
 * Pipe reutilizável — rejeita payloads inválidos antes dos use cases.
 * Segurança: mensagens estruturadas sem vazar stack interna.
 * =============================================================================
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    try {
      return this.schema.parse(value ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Erro de validação',
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      throw new BadRequestException('Payload inválido');
    }
  }
}
