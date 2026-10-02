import { SetMetadata } from '@nestjs/common';

/** Marca rotas públicas (health, webhook Mercado Pago). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
