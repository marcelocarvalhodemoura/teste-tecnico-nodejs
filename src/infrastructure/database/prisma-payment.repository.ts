import { Injectable } from '@nestjs/common';
import { Payment as PrismaPayment, Prisma } from '@prisma/client';
import { Payment } from '@domain/payment/entities/payment.entity';
import { Cpf } from '@domain/payment/value-objects/cpf.vo';
import { Money } from '@domain/payment/value-objects/money.vo';
import { PaymentMethod } from '@domain/payment/enums/payment-method.enum';
import { PaymentStatus } from '@domain/payment/enums/payment-status.enum';
import {
  IPaymentRepository,
  PaymentFilters,
  PaginatedResult,
} from '@domain/payment/repositories/payment.repository';
import { PrismaService } from './prisma.service';

/**
 * =============================================================================
 * CLEAN ARCHITECTURE (doc §4): Adapter Prisma → Domínio
 * Performance: filtros indexados + paginação (skip/take).
 * Segurança: queries parametrizadas pelo Prisma Client.
 * =============================================================================
 */
@Injectable()
export class PrismaPaymentRepository implements IPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(payment: Payment): Promise<Payment> {
    const data = this.toPrismaCreate(payment);
    const saved = await this.prisma.payment.create({ data });
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByExternalId(externalId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { externalId } });
    return row ? this.toDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? this.toDomain(row) : null;
  }

  async findMany(filters: PaymentFilters): Promise<PaginatedResult<Payment>> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {};

    if (filters.cpf) {
      where.cpf = filters.cpf.replace(/\D/g, '');
    }
    if (filters.paymentMethod) {
      where.paymentMethod = filters.paymentMethod;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toDomain(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async update(payment: Payment): Promise<Payment> {
    const primitives = payment.toPrimitives();
    const updated = await this.prisma.payment.update({
      where: { id: primitives.id },
      data: {
        description: primitives.description,
        status: primitives.status,
        externalId: primitives.externalId,
        mercadoPagoPaymentId: primitives.mercadoPagoPaymentId,
        idempotencyKey: primitives.idempotencyKey,
        amount: new Prisma.Decimal(primitives.amount.toFixed(2)),
      },
    });
    return this.toDomain(updated);
  }

  private toPrismaCreate(payment: Payment): Prisma.PaymentCreateInput {
    const p = payment.toPrimitives();
    return {
      id: p.id,
      cpf: p.cpf,
      description: p.description,
      amount: new Prisma.Decimal(p.amount.toFixed(2)),
      paymentMethod: p.paymentMethod,
      status: p.status,
      externalId: p.externalId,
      mercadoPagoPaymentId: p.mercadoPagoPaymentId,
      idempotencyKey: p.idempotencyKey,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private toDomain(row: PrismaPayment): Payment {
    return Payment.reconstitute({
      id: row.id,
      cpf: Cpf.create(row.cpf),
      description: row.description,
      amount: Money.fromReais(Number(row.amount)),
      paymentMethod: row.paymentMethod as PaymentMethod,
      status: row.status as PaymentStatus,
      externalId: row.externalId,
      mercadoPagoPaymentId: row.mercadoPagoPaymentId,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
