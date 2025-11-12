import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Current User decorator
 * Extract user information from request
 * 
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: any) { ... }
 * 
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser('userId') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
