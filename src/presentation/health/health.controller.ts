import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { Public } from '@shared/decorators/public.decorator';

/**
 * Healthcheck para Docker / load balancer.
 * Verifica conectividade com PostgreSQL via Prisma.
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

    const status = database === 'up' ? 'ok' : 'degraded';

    return {
      status,
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
