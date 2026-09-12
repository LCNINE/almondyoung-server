import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface UserContact {
  userId: string;
  email: string;
  username: string;
}

/** 한 번에 조회할 userId 개수. user-service DTO 의 ArrayMaxSize(500) 와 맞춘다. */
const CHUNK_SIZE = 500;

/**
 * 청크 하나의 상한. `HttpModule` 은 어느 앱에서도 설정 없이 등록돼 있어 axios 기본값(=무제한)이
 * 그대로 적용된다 — user-service 가 «연결은 받고 응답을 안 하는» 상태면 호출자가 영원히 매달린다.
 *
 * 이게 알림 경로 밖까지 번진다: wallet 은 선적용 가입의 agreement 생성 «요청 안에서» 이걸 부르므로,
 * 멈추면 membership 의 재시도·void 경로도 돌지 못하고 가입 자체가 서 버린다. 연락처를 못 찾는 것은
 * 통지를 거르는 사유일 뿐이므로, 늦는 것도 실패로 끊는다.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * user-service 의 서버 간(internal) 연락처 조회 클라이언트.
 *
 * 서비스들은 userId 만 들고 있고 이메일을 갖지 않는다(SoT 는 user-service). 계약에 이메일을
 * 복제해 두면 이메일 변경이 전파되지 않아 옛 주소로 발송되므로, 발송 시점에 조회한다.
 *
 * 쓰는 쪽: membership(갱신·만료 사전 고지), wallet(CMS 계좌 심사 거절 통지).
 * 주입하려면 그 앱 모듈에 HttpModule 과 이 클래스를 provider 로 넣고,
 * USER_SERVICE_URL / USER_SERVICE_INTERNAL_KEY env 를 붙여야 한다.
 */
@Injectable()
export class UserContactClient {
  private readonly logger = new Logger(UserContactClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async findContacts(userIds: string[]): Promise<Map<string, UserContact>> {
    const result = new Map<string, UserContact>();
    if (userIds.length === 0) return result;

    const baseUrl = this.configService.get<string>('USER_SERVICE_URL');
    const key = this.configService.get<string>('USER_SERVICE_INTERNAL_KEY');
    if (!baseUrl || !key) {
      throw new Error('USER_SERVICE_URL or USER_SERVICE_INTERNAL_KEY is not configured');
    }

    for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + CHUNK_SIZE);
      // user-service 는 전역 ResponseInterceptor 로 모든 응답을 { success, data } 로 감싼다.
      const { data } = await firstValueFrom(
        this.httpService.post<{ data: UserContact[] }>(
          `${baseUrl}/users/internal/contacts`,
          { userIds: chunk },
          { headers: { Authorization: `Bearer ${key}` }, timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      for (const contact of data.data) {
        result.set(contact.userId, contact);
      }
    }

    const missing = userIds.length - result.size;
    if (missing > 0) {
      this.logger.warn(`연락처를 찾지 못한 사용자 ${missing}명 — 탈퇴 계정이거나 계정이 사라진 경우`);
    }
    return result;
  }
}
