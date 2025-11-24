import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Authentication Service
 * Handles JWT token validation and user authentication
 */
@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);

  /**
   * Validate JWT payload
   * Maps payload to user object (Stateless - no DB query)
   *
   * @param payload - JWT token payload
   * @returns User object with userId, roles, email, etc.
   */
  validatePayload(payload: any) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.sub,
      roles: payload.roles || [],
      scopes: payload.scopes || [],
      email: payload.email,
      ...payload,
    };
  }
}
