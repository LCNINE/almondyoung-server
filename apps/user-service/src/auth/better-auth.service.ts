import { AUTH_INSTANCE_KEY } from '../constants/auth.constant';
import { Inject, Injectable } from '@nestjs/common';
import type { Auth } from 'better-auth/auth';

/**
 * 참고: 이 서비스는 오직 better auth 관련 작업을 처리하기 위한 것입니다.
 * AuthService가 `better-auth.config.ts` 내부에서 사용되고 있어 순환 참조가 발생하므로 여기서 `auth.service.ts`를 import할 수 없습니다.
 */
@Injectable()
export class BetterAuthService {
  constructor(
    @Inject(AUTH_INSTANCE_KEY)
    private readonly auth: Auth,
  ) {}

  get api() {
    return this.auth.api;
  }
}
