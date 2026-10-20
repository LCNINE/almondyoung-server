import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { seoulDate, verifyLocation, type LocationSample } from '@packages/domain-types/attendance';
import { AttendanceRepository, serializeSession } from '../repositories/attendance.repository';

export interface PunchInput {
  kind: 'in' | 'out';
  requestId: string;
  siteId: string;
  location: LocationSample;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly repo: AttendanceRepository) {}

  async punch(userId: string, dto: PunchInput, now = new Date()) {
    return this.repo.withUserLock(userId, async (tx) => {
      const previous = await this.repo.findPunch(tx, userId, dto.requestId);

      if (previous) {
        if (previous.kind !== dto.kind) {
          throw new ConflictException('이미 다른 기록에 사용한 요청이에요.');
        }

        return previous.result;
      }

      const site = await this.repo.getSite(tx, dto.siteId);

      if (!site) {
        throw new ServiceUnavailableException('등록된 근무지가 없어요. 마스터에게 문의해 주세요.');
      }

      try {
        verifyLocation(dto.location, site, now);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }

      const open = await this.repo.findOpen(tx, userId);

      let session: Awaited<ReturnType<AttendanceRepository['createSession']>> | undefined;

      if (dto.kind === 'in') {
        if (open || (await this.repo.findDay(tx, userId, seoulDate(now)))) {
          throw new ConflictException('이미 출근 기록이 있어요. 현재 상태를 새로 확인해 주세요.');
        }

        session = await this.repo.createSession(tx, userId, seoulDate(now), now);
      } else {
        if (!open) {
          throw new ConflictException('퇴근할 출근 기록이 없어요.');
        }

        if (open.checkIn >= now) {
          throw new ConflictException('출근 이후에 퇴근을 기록해 주세요.');
        }

        session = await this.repo.finishSession(tx, open.id, now);
      }

      if (!session) {
        throw new ConflictException('기록이 변경됐어요. 다시 확인해 주세요.');
      }

      const result = serializeSession(session);

      await this.repo.appendPunch(tx, {
        userId,
        requestId: dto.requestId,
        kind: dto.kind,
        sessionId: session.id,
        siteId: site.id,
        policyVersion: site.version,
        recordedAt: now,
        result,
      });

      return result;
    });
  }
}
