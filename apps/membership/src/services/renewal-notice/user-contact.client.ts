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
 * user-service 의 서버 간(internal) 연락처 조회 클라이언트.
 *
 * membership 은 userId 만 들고 있고 이메일을 갖지 않는다(SoT 는 user-service). 계약에 이메일을
 * 복제해 두면 이메일 변경이 전파되지 않아 옛 주소로 발송되므로, 발송 시점에 조회한다.
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
      const { data } = await firstValueFrom(
        this.httpService.post<UserContact[]>(
          `${baseUrl}/users/internal/contacts`,
          { userIds: chunk },
          { headers: { Authorization: `Bearer ${key}` } },
        ),
      );
      for (const contact of data) {
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
