import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser } from '../strategies/jwt.strategy';

/**
 * @Get('me')
 * me(@CurrentUser() user: JwtUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtUser }>();
    return request.user;
  },
);
