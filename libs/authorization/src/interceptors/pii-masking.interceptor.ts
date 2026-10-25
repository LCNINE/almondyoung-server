import {
  CallHandler,
  ForbiddenException,
  ServiceUnavailableException,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { from, Observable, mergeMap } from 'rxjs';
import { countRawValues, maskPaths, readPathValues, type PiiKind, type PiiPath } from '@app/shared/pii';
import {
  DEFAULT_PII_RAW_WITH,
  isPiiExport,
  piiResponseOf,
  piiWriteOf,
  type PiiWriteSpec,
  type PiiResponseSpec,
  type PiiSubjectType,
} from '../decorators/pii-response.decorator';
import type { OwnerService } from '../permissions/permission.types';
import { PII_ACCESS_SUBJECT_CAP, PiiAccessRecorder, type PiiAccessAction } from '../services/pii-access-recorder';
import { PermissionAuthority } from '../services/permission-authority';
import { PermissionCache } from '../services/permission-cache';
import { methodOf, rawResponseOf, rolesOf } from '../services/request-identity';
import { staffClientOf } from '../services/staff-client';
import { readPiiExportReason } from '../pii/pii-export-reason';

export const PII_MASKING_OPTIONS = Symbol('PII_MASKING_OPTIONS');

export interface PiiMaskingOptions {
  readonly service: OwnerService;
  /** 켜면 `customer.pii.read` 보유자도 가린 값을 받고 [보기](`X-Pii-Reveal: 1`)로 원문을 연다. */
  readonly revealRequired: boolean;
  /** 이 앱이 응답을 `{ success, data }` 로 감싸면 경로를 `data` 안에 적용한다. */
  readonly envelope: 'none' | 'success-data';
}

type MaskReason = 'no-permission' | 'reveal-required' | 'unavailable' | 'record-failed';

const REASON_PRIORITY: readonly MaskReason[] = ['unavailable', 'record-failed', 'reveal-required', 'no-permission'];
const PII_READ = 'customer.pii.read';

interface RequestFacts {
  readonly userId: string | null;
  readonly loginId: string | null;
  readonly roles: readonly string[] | undefined;
  readonly header: (name: string) => string | null;
  readonly queryKeys: string[];
  readonly route: string;
  readonly param: (name: string) => string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function factsOf(request: unknown): RequestFacts {
  const record = isRecord(request) ? request : {};
  const user = isRecord(record.user) ? record.user : {};
  const headers = isRecord(record.headers) ? record.headers : {};
  const query = isRecord(record.query) ? record.query : {};
  const params = isRecord(record.params) ? record.params : {};
  const routeOptions = isRecord(record.routeOptions) ? record.routeOptions : {};
  const expressRoute = isRecord(record.route) ? record.route : {};
  const rawUrl = typeof record.url === 'string' ? record.url.split('?')[0] : '?';
  const route =
    typeof routeOptions.url === 'string' ? routeOptions.url : typeof expressRoute.path === 'string' ? expressRoute.path : rawUrl;
  return {
    // user-service 자체 전략은 `id`, 공용 전략(`validatePayload`)은 `userId`·`sub` 를 싣는다.
    userId: [user.id, user.userId, user.sub].find((v): v is string => typeof v === 'string' && v !== '') ?? null,
    loginId: typeof user.login_id === 'string' ? user.login_id : null,
    roles: rolesOf(request),
    header: (name) => {
      const value = headers[name];
      return typeof value === 'string' && value !== '' ? value.slice(0, 500) : null;
    },
    queryKeys: Object.keys(query),
    route,
    param: (name) => {
      const value = params[name];
      return typeof value === 'string' && value !== '' ? value : null;
    },
  };
}

/**
 * 개인정보 표시 제한. `@PiiResponse` 가 붙은 라우트에서만 돈다(ADR-0048).
 * 원문을 받는 직원: 응답 객체를 그대로 넘기고(다시 직렬화하지 않는다) 접속기록 1행을 «응답 전에» 남긴다 — 기록에
 * 실패하면 가린다. 권한이 없거나 권한 사본이 없으면 가린 사본을 넘기고 사유를 `X-Pii-Mask-Reason` 으로 알린다.
 */
@Injectable()
export class PiiMaskingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PiiMaskingInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PermissionCache) private readonly cache: Pick<PermissionCache, 'permissionsFor'>,
    @Inject(PiiAccessRecorder) private readonly recorder: PiiAccessRecorder,
    @Inject(PII_MASKING_OPTIONS) private readonly options: PiiMaskingOptions,
    /** 권한 사본이 없을 때 쓰기를 막을지 — 새 판정이 결정하는 서비스만 막는다(라우트 판정과 같은 규칙). */
    @Optional() @Inject(PermissionAuthority) private readonly authority?: Pick<PermissionAuthority, 'enforced'>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const write = piiWriteOf(this.reflector, context.getHandler());
    if (write) this.assertCanWrite(write, context.switchToHttp().getRequest<unknown>());
    const spec = piiResponseOf(this.reflector, context.getHandler());
    if (!spec) return next.handle();
    const exporting = isPiiExport(this.reflector, context.getHandler());
    const http = context.switchToHttp();
    const request = http.getRequest<unknown>();
    const response = http.getResponse<unknown>();
    return next.handle().pipe(mergeMap((body) => from(this.apply(spec, exporting, request, response, body))));
  }

  /** 본문에 개인정보 필드 값이 있는데 그 원문을 볼 권한이 없으면 핸들러를 부르지 않는다. */
  private assertCanWrite(spec: PiiWriteSpec, request: unknown): void {
    const body = isRecord(request) ? request.body : undefined;
    // 값을 비우는 것(null·빈 문자열)도 고치는 것이다. 그 필드를 담은 객체를 null 로 보내는 것도 같다.
    const sent = spec.fields.filter((path) => {
      const parts = path.split('.');
      for (let depth = 1; depth < parts.length; depth += 1) {
        if (readPathValues(body, parts.slice(0, depth).join('.')).some((value) => value === null)) return true;
      }
      return readPathValues(body, path).length > 0;
    });
    if (sent.length === 0) return;
    const facts = factsOf(request);
    const rawWith = spec.rawWith ?? DEFAULT_PII_RAW_WITH;
    const permissions = facts.roles === undefined ? new Set<string>() : this.cache.permissionsFor(facts.roles);
    if (permissions === null) {
      if (this.authority?.enforced !== true) return;
      throw new ServiceUnavailableException('Permission data is not loaded yet');
    }
    if (rawWith.some((permission) => permissions.has(permission))) return;
    throw new ForbiddenException({ message: 'Permission required', requiredPermissions: rawWith });
  }

  private async apply(
    spec: PiiResponseSpec,
    exporting: boolean,
    request: unknown,
    response: unknown,
    body: unknown,
  ): Promise<unknown> {
    const facts = factsOf(request);
    const inner = this.unwrap(body);
    const raw: Record<PiiPath, PiiKind> = {};
    const masked: Record<PiiPath, PiiKind> = {};
    const reasons = new Set<MaskReason>();
    let revealable = false;

    const permissions = facts.userId === null || facts.roles === undefined ? undefined : this.cache.permissionsFor(facts.roles);
    const revealAsked = spec.reveal === true && facts.header('x-pii-reveal') === '1';

    for (const [path, kind] of Object.entries(spec.fields)) {
      if (permissions === undefined) {
        masked[path] = kind;
        reasons.add('no-permission');
        continue;
      }
      if (permissions === null) {
        masked[path] = kind;
        reasons.add('unavailable');
        continue;
      }
      const opening = (spec.rawWithByField?.[path] ?? spec.rawWith ?? DEFAULT_PII_RAW_WITH).filter((key) =>
        permissions.has(key),
      );
      if (opening.length === 0) {
        masked[path] = kind;
        reasons.add('no-permission');
        continue;
      }
      const onlyPiiRead = opening.every((key) => key === PII_READ);
      if (this.options.revealRequired && onlyPiiRead && !revealAsked) {
        masked[path] = kind;
        reasons.add('reveal-required');
        if (spec.reveal === true) revealable = true;
        continue;
      }
      raw[path] = kind;
    }

    if (Object.keys(raw).length > 0 && countRawValues(inner, raw) > 0) {
      const reason = exporting ? this.exportReason(facts) : null;
      const action: PiiAccessAction = exporting ? 'export' : revealAsked && this.options.revealRequired ? 'reveal' : 'view';
      try {
        await this.recorder.record(this.recordOf(spec, facts, request, inner, raw, action, reason));
      } catch (error) {
        this.logger.warn(`pii_access_record_failed route=${facts.route} ${error instanceof Error ? error.message : ''}`);
        for (const [path, kind] of Object.entries(raw)) masked[path] = kind;
        reasons.add('record-failed');
      }
    }

    const result = maskPaths(inner, masked);
    this.setHeaders(response, result.maskedKinds, result.redactedPaths, reasons, revealable && result.maskedValueCount > 0);
    if (result.maskedValueCount === 0) return body;
    return this.rewrap(body, result.body);
  }

  private exportReason(facts: RequestFacts): string {
    return readPiiExportReason(facts.header('x-pii-export-reason'));
  }

  private recordOf(
    spec: PiiResponseSpec,
    facts: RequestFacts,
    request: unknown,
    inner: unknown,
    raw: Readonly<Record<PiiPath, PiiKind>>,
    action: PiiAccessAction,
    reason: string | null,
  ) {
    const seen = new Set<string>();
    const buckets = spec.subjects.map((subject) => {
      const bucket: { type: PiiSubjectType; id: string }[] = [];
      const values = subject.path !== undefined ? readPathValues(inner, subject.path) : [facts.param(subject.param ?? '')];
      for (const value of values) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const id = subject.hash === true ? `h:${createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}` : String(value);
        const key = `${subject.type}\u0000${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.push({ type: subject.type, id });
      }
      return bucket;
    });
    const subjects = interleave(buckets);
    if (subjects.length === 0) this.logger.warn(`pii_access_without_subject route=${facts.route}`);
    const client = staffClientOf(request);
    return {
      eventId: randomUUID(),
      actorUserId: facts.userId ?? '',
      actorLoginId: facts.loginId,
      claimedIp: client.claimedIp,
      peerIp: client.peerIp,
      forwardedFor: client.forwardedFor,
      userAgent: facts.header('user-agent'),
      requestId: facts.header('x-request-id'),
      sourceService: this.options.service,
      method: methodOf(request),
      route: facts.route,
      action,
      subjects: subjects.slice(0, PII_ACCESS_SUBJECT_CAP),
      subjectCount: subjects.length,
      kinds: [...new Set(Object.values(raw))],
      queryKeys: facts.queryKeys,
      reason,
      occurredAt: new Date(),
    };
  }

  private unwrap(body: unknown): unknown {
    if (this.options.envelope === 'success-data' && isRecord(body) && 'success' in body && 'data' in body) return body.data;
    return body;
  }

  private rewrap(original: unknown, maskedInner: unknown): unknown {
    if (this.options.envelope === 'success-data' && isRecord(original) && 'success' in original && 'data' in original) {
      return { ...original, data: maskedInner };
    }
    return maskedInner;
  }

  private setHeaders(
    response: unknown,
    kinds: readonly PiiKind[],
    redacted: readonly PiiPath[],
    reasons: ReadonlySet<MaskReason>,
    revealable: boolean,
  ): void {
    const raw = rawResponseOf(response);
    if (!raw || raw.headersSent) return;
    raw.setHeader('x-pii-masked', kinds.length === 0 ? 'none' : [...kinds].sort().join(','));
    if (kinds.length === 0) return;
    const reason = REASON_PRIORITY.find((candidate) => reasons.has(candidate));
    if (reason) raw.setHeader('x-pii-mask-reason', reason);
    if (redacted.length > 0) raw.setHeader('x-pii-redacted', [...redacted].sort().join(','));
    if (revealable) raw.setHeader('x-pii-revealable', '1');
  }
}

/** 선언마다 하나씩 번갈아 꺼낸다 — 상한에서 잘려도 뒤에 선언한 대상 종류가 통째로 빠지지 않게. */
function interleave<T>(buckets: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...buckets.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const bucket of buckets) if (i < bucket.length) out.push(bucket[i]);
  return out;
}
