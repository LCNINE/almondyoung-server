import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { isWorkDate, seoulDate, type RequestStatus } from '@packages/domain-types/attendance';
import {
  attendanceAudit,
  attendanceJobs,
  attendanceRequests,
  attendanceSessions,
  users,
} from '../../../../database/drizzle/schema';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { CreateRequestDto, DecisionDto } from '../dto/attendance.dto';

export function validateCorrection(dto: CreateRequestDto, now = new Date()) {
  if (
    !isWorkDate(dto.workDate) ||
    dto.workDate > seoulDate(now) ||
    !dto.reason?.trim() ||
    (!dto.checkIn && !dto.checkOut)
  ) {
    throw new BadRequestException('근무일, 실제 시각과 상세 사유를 입력해 주세요.');
  }
  const checkIn = dto.checkIn ? new Date(dto.checkIn) : null;
  const checkOut = dto.checkOut ? new Date(dto.checkOut) : null;
  if (
    [checkIn, checkOut].some((time) => time && (!Number.isFinite(time.getTime()) || time > now)) ||
    (checkIn && seoulDate(checkIn) !== dto.workDate) ||
    (checkIn && checkOut && checkOut <= checkIn)
  ) {
    throw new BadRequestException('실제 근무 날짜와 출퇴근 시각 순서를 확인해 주세요.');
  }

  return {
    workDate: dto.workDate,
    reason: dto.reason.trim(),
    checkIn,
    checkOut,
    fileIds: [...new Set(dto.fileIds ?? [])],
  };
}

export function assertDecisionAllowed(roles: string[], status: RequestStatus, current: number, expected: number) {
  if (!roles.includes('master')) throw new ForbiddenException('마스터만 처리할 수 있어요.');
  if (status !== 'pending' || current !== expected)
    throw new ConflictException('이미 처리되었거나 변경된 요청이에요. 새로 확인해 주세요.');
}

@Injectable()
export class AttendanceRequestManager {
  constructor(private readonly repo: AttendanceRepository) {}

  async list(userId: string, master = false) {
    const rows = await this.repo.db
      .select({ request: attendanceRequests, name: users.username })
      .from(attendanceRequests)
      .innerJoin(users, eq(users.id, attendanceRequests.userId))
      .where(master ? undefined : eq(attendanceRequests.userId, userId))
      .orderBy(desc(attendanceRequests.createdAt))
      .limit(100);

    return rows.map(({ request, name }) => (master ? { ...request, name } : { ...request, name, aiResult: undefined }));
  }

  async verifyFiles(userId: string, fileIds: string[]) {
    if (!fileIds.length) return;
    if (fileIds.length > 3) throw new BadRequestException('이미지는 최대 3장까지 첨부할 수 있어요.');
    const base = process.env.FILE_SERVICE_URL;
    const key = process.env.FILE_SERVICE_INTERNAL_KEY;
    if (!base || !key)
      throw new ServiceUnavailableException(
        '첨부 확인을 준비 중이에요. 첨부 없이 요청하거나 잠시 후 다시 시도해 주세요.',
      );

    for (const id of fileIds) {
      const response = await fetch(`${base.replace(/\/$/, '')}/internal/files/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new BadRequestException('첨부 파일을 확인하지 못했어요.');
      const raw = await response.json();
      const file = raw.data ?? raw;
      if (
        file.uploadedBy !== userId ||
        file.contextId !== 'attendance-request-image' ||
        file.status !== 'active' ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)
      ) {
        throw new BadRequestException('본인이 올린 출결 참고 이미지만 첨부할 수 있어요.');
      }
    }
  }

  async create(userId: string, dto: CreateRequestDto) {
    const input = validateCorrection(dto);
    await this.verifyFiles(userId, input.fileIds);

    return this.repo.withUserLock(userId, async (tx) => {
      const session = await this.repo.findDay(tx, userId, input.workDate);
      const [request] = await tx
        .insert(attendanceRequests)
        .values({ ...input, userId, sessionId: session?.id ?? null, targetVersion: session?.version ?? null })
        .returning();
      await tx
        .insert(attendanceAudit)
        .values({ actorId: userId, subjectId: userId, kind: 'request.created', entityId: request.id, after: request });
      await tx
        .insert(attendanceJobs)
        .values({
          key: `ai:${request.id}:1`,
          kind: 'ai',
          userId,
          payload: { requestId: request.id, version: 1 },
          expiresAt: new Date(Date.now() + 86400000),
        });
      await tx
        .insert(attendanceJobs)
        .values({
          key: `request:${request.id}:1`,
          kind: 'new_request',
          userId,
          payload: { requestId: request.id },
          expiresAt: new Date(Date.now() + 86400000),
        });

      return request;
    });
  }

  async decide(actorId: string, roles: string[], id: string, dto: DecisionDto) {
    const [target] = await this.repo.db.select().from(attendanceRequests).where(eq(attendanceRequests.id, id));
    if (!target) throw new NotFoundException('요청을 찾을 수 없어요.');

    return this.repo.withUserLock(target.userId, async (tx) => {
      const [request] = await tx.select().from(attendanceRequests).where(eq(attendanceRequests.id, id)).for('update');
      assertDecisionAllowed(roles, request.status, request.version, dto.version);
      if (dto.status !== 'approved' && !dto.reason.trim()) throw new BadRequestException('처리 사유를 입력해 주세요.');
      const existing = await this.repo.findDay(tx, request.userId, request.workDate);

      if (dto.status === 'approved') {
        if ((existing?.id ?? null) !== request.sessionId || (existing?.version ?? null) !== request.targetVersion) {
          throw new ConflictException('요청 이후 원래 기록이 변경됐어요. 다시 확인해 주세요.');
        }
        const checkIn = request.checkIn ?? existing?.checkIn;
        const checkOut = request.checkOut ?? existing?.checkOut ?? null;
        if (!checkIn || (checkOut && checkOut <= checkIn))
          throw new BadRequestException('출근 시각과 퇴근 시각을 확인해 주세요.');
        const open = await this.repo.findOpen(tx, request.userId);
        if (open && open.id !== existing?.id && !checkOut)
          throw new ConflictException('다른 열린 출근 기록이 있어요. 먼저 해당 기록을 확인해 주세요.');
        const [changed] = existing
          ? await tx
              .update(attendanceSessions)
              .set({ checkIn, checkOut, version: sql`${attendanceSessions.version} + 1` })
              .where(eq(attendanceSessions.id, existing.id))
              .returning()
          : await tx
              .insert(attendanceSessions)
              .values({ userId: request.userId, workDate: request.workDate, checkIn, checkOut })
              .returning();
        await tx
          .insert(attendanceAudit)
          .values({
            actorId,
            subjectId: request.userId,
            kind: 'session.corrected',
            entityId: changed.id,
            before: existing ?? null,
            after: changed,
          });
      }
      const [changed] = await tx
        .update(attendanceRequests)
        .set({
          status: dto.status,
          decisionReason: dto.reason.trim(),
          decidedBy: actorId,
          decidedAt: new Date(),
          version: request.version + 1,
        })
        .where(eq(attendanceRequests.id, id))
        .returning();
      await tx
        .insert(attendanceAudit)
        .values({
          actorId,
          subjectId: request.userId,
          kind: 'request.decided',
          entityId: id,
          before: request,
          after: changed,
        });
      await tx
        .insert(attendanceJobs)
        .values({
          key: `decision:${id}:${changed.version}`,
          kind: 'decision',
          userId: request.userId,
          payload: { requestId: id },
          expiresAt: new Date(Date.now() + 86400000),
        });

      return changed;
    });
  }

  async resubmit(userId: string, id: string, dto: CreateRequestDto) {
    const input = validateCorrection(dto);
    await this.verifyFiles(userId, input.fileIds);

    return this.repo.withUserLock(userId, async (tx) => {
      const [request] = await tx
        .select()
        .from(attendanceRequests)
        .where(and(eq(attendanceRequests.id, id), eq(attendanceRequests.userId, userId)))
        .for('update');
      if (!request) throw new NotFoundException('요청을 찾을 수 없어요.');
      if (request.status !== 'needs_information' || request.workDate !== input.workDate)
        throw new ConflictException('보완 요청 상태와 근무일을 확인해 주세요.');
      const session = await this.repo.findDay(tx, userId, input.workDate);
      const version = request.version + 1;
      const [changed] = await tx
        .update(attendanceRequests)
        .set({
          ...input,
          status: 'pending',
          version,
          targetVersion: session?.version ?? null,
          sessionId: session?.id ?? null,
          aiStatus: 'queued',
          aiResult: null,
          decidedBy: null,
          decidedAt: null,
          decisionReason: null,
        })
        .where(eq(attendanceRequests.id, id))
        .returning();
      await tx
        .insert(attendanceAudit)
        .values({
          actorId: userId,
          subjectId: userId,
          kind: 'request.resubmitted',
          entityId: id,
          before: request,
          after: changed,
        });
      await tx
        .insert(attendanceJobs)
        .values({
          key: `ai:${id}:${version}`,
          kind: 'ai',
          userId,
          payload: { requestId: id, version },
          expiresAt: new Date(Date.now() + 86400000),
        });

      return changed;
    });
  }
}
