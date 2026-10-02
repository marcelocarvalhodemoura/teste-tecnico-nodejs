import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { Public } from '@shared/decorators/public.decorator';

/**
 * Healthcheck para Docker / load balancer.
 * Verifica conectividade com PostgreSQL via Prisma.
 * Banco fora → 503, para o HEALTHCHECK do Docker / load balancer detectar.
 * @Public — sem API Key (probes de infra).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check (API + Postgres)' })
  async check() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const body = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };

    if (database === 'down') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
