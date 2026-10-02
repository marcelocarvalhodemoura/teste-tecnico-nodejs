import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';

/**
 * =============================================================================
 * Segurança: autenticação por API Key (header x-api-key).
 * Rotas @Public() ficam liberadas (health + webhook MP com HMAC próprio).
 * =============================================================================
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const expected = this.config.get<string>('API_KEY');
    // Em test/dev sem API_KEY configurada, não bloqueia (DX local).
    // Em production a env validation exige API_KEY.
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const provided = request.headers['x-api-key'];

    if (!provided || !this.keysMatch(provided, expected)) {
      throw new UnauthorizedException('API Key inválida ou ausente');
    }

    return true;
  }

  private keysMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
