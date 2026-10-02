import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBody,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiSecurity,
} from '@nestjs/swagger';
import { CreatePaymentUseCase } from '@application/payment/use-cases/create-payment.use-case';
import { UpdatePaymentUseCase } from '@application/payment/use-cases/update-payment.use-case';
import { GetPaymentByIdUseCase } from '@application/payment/use-cases/get-payment-by-id.use-case';
import { ListPaymentsUseCase } from '@application/payment/use-cases/list-payments.use-case';
import {
  createPaymentSchema,
  updatePaymentSchema,
  listPaymentsSchema,
  paymentIdSchema,
  CreatePaymentDto,
  UpdatePaymentDto,
  ListPaymentsDto,
} from '@application/payment/dto/payment.schemas';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';

/** Schemas OpenAPI espelhando os schemas Zod (Swagger "Try it out"). */
const createPaymentBody = {
  type: 'object',
  required: ['cpf', 'description', 'amount', 'paymentMethod'],
  properties: {
    cpf: { type: 'string', example: '529.982.247-25' },
    description: {
      type: 'string',
      minLength: 3,
      maxLength: 255,
      example: 'Assinatura mensal',
    },
    amount: { type: 'number', minimum: 0.01, maximum: 1_000_000, example: 99.9 },
    paymentMethod: { type: 'string', enum: ['PIX', 'CREDIT_CARD'], example: 'PIX' },
  },
};

const updatePaymentBody = {
  type: 'object',
  description: 'Informe ao menos status ou description. Status manual apenas para PIX.',
  properties: {
    status: { type: 'string', enum: ['PENDING', 'PAID', 'FAIL'], example: 'PAID' },
    description: { type: 'string', minLength: 3, maxLength: 255 },
  },
};

/**
 * =============================================================================
 * FUNCIONALIDADES DA API (doc §1) — padrão RESTful (doc §4)
 *
 * POST   /api/payment       → Adicionar Pagamento
 * PUT    /api/payment/{id}  → Atualizar Pagamento (restrito)
 * GET    /api/payment/{id}  → Buscar Pagamento por ID
 * GET    /api/payment       → Listar Pagamentos (filtros: CPF, paymentMethod)
 * =============================================================================
 */
@ApiTags('payments')
@ApiSecurity('api-key')
@Controller('payment')
export class PaymentController {
  constructor(
    private readonly createPayment: CreatePaymentUseCase,
    private readonly updatePayment: UpdatePaymentUseCase,
    private readonly getPaymentById: GetPaymentByIdUseCase,
    private readonly listPayments: ListPaymentsUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Adicionar Pagamento (doc §1)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Evita cobranças duplicadas em retries do cliente',
  })
  @ApiBody({ schema: createPaymentBody })
  @ApiResponse({ status: 201, description: 'Pagamento criado (PENDING)' })
  @ApiResponse({ status: 400, description: 'Validação inválida (Zod)' })
  create(
    @Body(new ZodValidationPipe(createPaymentSchema)) dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.createPayment.execute({
      ...dto,
      idempotencyKey: idempotencyKey?.trim() || undefined,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Listar Pagamentos com filtros CPF / meio de pagamento (doc §1)',
  })
  findAll(@Query(new ZodValidationPipe(listPaymentsSchema)) query: ListPaymentsDto) {
    return this.listPayments.execute(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar Pagamento por ID (doc §1)' })
  findOne(@Param('id', new ZodValidationPipe(paymentIdSchema)) id: string) {
    return this.getPaymentById.execute(id);
  }

  @Put(':id')
  @ApiOperation({
    summary:
      'Atualizar Pagamento (doc §1) — description; status só PIX (CREDIT_CARD via webhook)',
  })
  @ApiBody({ schema: updatePaymentBody })
  @ApiResponse({ status: 409, description: 'Status manual em CREDIT_CARD' })
  update(
    @Param('id', new ZodValidationPipe(paymentIdSchema)) id: string,
    @Body(new ZodValidationPipe(updatePaymentSchema)) dto: UpdatePaymentDto,
  ) {
    return this.updatePayment.execute(id, dto);
  }
}
