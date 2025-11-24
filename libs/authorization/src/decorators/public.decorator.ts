import { SetMetadata } from '@nestjs/common';

/**
 * Public route decorator
 * Routes marked with @Public() will bypass JWT authentication
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
