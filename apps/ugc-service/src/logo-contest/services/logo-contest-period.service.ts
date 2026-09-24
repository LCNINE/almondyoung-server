import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestError } from '@app/shared';

/**
 * 공모전이 한 번뿐이라 `contests` 테이블 대신 설정값 두 개가 기간을 들고 있다.
 * UI 숨김은 보조일 뿐이고, 출품·투표는 **요청마다** 여기서 거부된다.
 *
 * 값은 오프셋을 붙여 적는다 (`2026-10-01T00:00:00+09:00`) — 서버는 UTC 라
 * 오프셋 없이 적으면 9시간 밀린다.
 */
const DEFAULT_STARTS_AT = '2026-10-01T00:00:00+09:00';
const DEFAULT_ENDS_AT = '2026-10-30T23:59:59+09:00';

@Injectable()
export class LogoContestPeriodService {
  private readonly logger = new Logger(LogoContestPeriodService.name);
  readonly startsAt: Date;
  readonly endsAt: Date;

  constructor(configService: ConfigService) {
    this.startsAt = this.parse(configService.get<string>('LOGO_CONTEST_STARTS_AT'), DEFAULT_STARTS_AT);
    this.endsAt = this.parse(configService.get<string>('LOGO_CONTEST_ENDS_AT'), DEFAULT_ENDS_AT);
  }

  isOpen(now: Date = new Date()): boolean {
    return now >= this.startsAt && now <= this.endsAt;
  }

  isClosed(now: Date = new Date()): boolean {
    return now > this.endsAt;
  }

  assertOpen(now: Date = new Date()): void {
    if (now < this.startsAt) {
      throw new BadRequestError('공모전이 아직 시작하지 않았습니다.');
    }
    if (now > this.endsAt) {
      throw new BadRequestError('공모전이 마감되었습니다.');
    }
  }

  private parse(raw: string | undefined, fallback: string): Date {
    const parsed = new Date(raw ?? fallback);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(`잘못된 공모전 기간 설정값(${raw}) — 기본값 ${fallback} 으로 되돌립니다.`);
      return new Date(fallback);
    }
    return parsed;
  }
}
