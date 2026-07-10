import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { UserEvents } from '@packages/event-contracts/streams';
import { userServiceSchema, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { eq } from 'drizzle-orm';
import { SendEmailCodeDto } from '../dto/email-verification.dto';
import { ExpireEmailCodesService } from './expire-email-codes.service';

@Injectable()
export class SendEmailCodeService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectStreamPublisher('users.events.v1') private readonly eventPublisher: StreamPublisher<UserEvents>,
    private readonly expireEmailCodesService: ExpireEmailCodesService,
  ) {}

  // 로그인한 사용자 본인의 이메일로만 코드 발송 (클라이언트가 임의 이메일 지정 불가)
  async sendCode(userId: string, dto: SendEmailCodeDto) {
    const purpose = dto.purpose ?? 'password_change';

    const [user] = await this.dbService.db
      .select({ email: userServiceSchema.users.email, name: userServiceSchema.users.username })
      .from(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1);

    if (!user?.email) {
      throw new NotFoundError('등록된 이메일이 없습니다');
    }

    // 기존 미검증 코드 만료 처리
    await this.expireEmailCodesService.expireExistingCodes(user.email);

    const code = this.generateCode().toString();
    await this.dbService.db.insert(userServiceSchema.emailVerifications).values({
      email: user.email,
      code,
      purpose,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3분
    });

    // 실제 이메일 발송은 notification 서비스가 Kafka 이벤트를 받아 처리
    await this.eventPublisher.publishEvent({
      eventType: 'UserVerificationCode',
      aggregateId: userId,
      payload: { userId, email: user.email, name: user.name?.trim() || '고객', code },
    });

    return '인증 코드를 이메일로 보냈습니다';
  }

  private generateCode() {
    return Math.floor(100000 + Math.random() * 900000);
  }
}
