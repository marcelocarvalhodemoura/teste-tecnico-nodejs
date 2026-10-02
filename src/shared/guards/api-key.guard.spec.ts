import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';
import { IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';

describe('ApiKeyGuard', () => {
  const makeGuard = (apiKey?: string, isPublic = false) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector;
    const config = {
      get: jest.fn().mockReturnValue(apiKey),
    } as unknown as ConfigService;
    return new ApiKeyGuard(reflector, config);
  };

  const makeContext = (apiKeyHeader?: string) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: apiKeyHeader ? { 'x-api-key': apiKeyHeader } : {},
        }),
      }),
    }) as unknown as ExecutionContext;

  it('libera rotas @Public()', () => {
    const guard = makeGuard('secret-api-key-123456', true);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('libera quando API_KEY não está configurada (dev/test)', () => {
    const guard = makeGuard(undefined, false);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('aceita x-api-key válida', () => {
    const guard = makeGuard('secret-api-key-123456', false);
    expect(guard.canActivate(makeContext('secret-api-key-123456'))).toBe(true);
  });

  it('rejeita x-api-key inválida', () => {
    const guard = makeGuard('secret-api-key-123456', false);
    expect(() => guard.canActivate(makeContext('wrong-key-xxxxxxxxxx'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita ausência de x-api-key quando API_KEY está setada', () => {
    const guard = makeGuard('secret-api-key-123456', false);
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });
});
