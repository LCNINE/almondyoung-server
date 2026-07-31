import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDb, DbService } from '@app/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type PimSchema,
  productImportSessions,
  productImportItems,
  productImportImages,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { ProductRecord } from '../dto/import.types';
import { ProductImportManager } from './product-import.manager';
import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { ProductImportImageFetcher } from './product-import-image.fetcher';
import { ProductImportFileClient, MAX_BYTES_BY_USAGE } from './product-import-file.client';
import { indexSessionImages, unresolvedImageError } from './product-import-image.resolver';

export const DEFAULT_COMMIT_SLICE = 20;
export const DEFAULT_PUBLISH_SLICE = 10;
export const DEFAULT_LEASE_MS = 60_000;
/**
 * 슬라이스 밖으로 탈출한 예외의 연속 허용 횟수. 넘으면 그 레인을 failed 로 확정한다.
 *
 * 재시도 주기는 틱 간격(5초)이 아니다 — 슬라이스가 탈출 예외로 죽으면 recordJobError 가
 * lease 를 의도적으로 지우지 않으므로, 다음 claim 은 `lease_until < NOW()` 에 막혀
 * leaseMs(기본 60초)를 기다린 뒤에야 다시 잡힌다. 즉 10회는 ~60초 간격 기준 상한까지
 * 최소 ~10분이다 — 일시적 DB 오류·배포 중 커넥션 끊김은 그 안에 회복되므로 "일시적
 * 오류로 임포트를 영구 실패시키지 않는다"는 원래 설계 의도가 보존된다. 진짜 결정적
 * 오류(payload 형태 불일치 등)만 상한에 닿는다.
 */
export const MAX_CONSECUTIVE_JOB_FAILURES = 10;

/**
 * 한 틱에 처리할 이미지 행 수. probe 는 바디를 안 받아 20개면 몇 초고, fetch 는 행마다
 * lease 를 갱신하므로 오래 걸려도 lease 를 잃지 않는다.
 *
 * ⚠️ **동시성은 여전히 1이다** — 이 값은 "한 틱에 몇 개"이지 "동시에 몇 개"가 아니다.
 * 근거는 core CPU 가 아니라 outbound NAT 다: 3,000장 × 평균 500KB ≈ 1.5GB 가 단일
 * t4g.nano fck-nat 을 지나고, 그 인스턴스는 Medusa·notification 의 outbound 와 공유된다.
 * 고정 EIP 라 소싱처가 IP 하나만 rate-limit 하면 전체가 막힌다.
 * 느리다는 판단이 나오면 **올려야 할 것은 이 슬라이스가 아니라 NAT 인스턴스 타입**이다
 * (deployments/lcnine/platform/infra/shared.ts:22 — `nat:"ec2"`, 타입 override 없음).
 */
export const DEFAULT_IMAGE_SLICE = 20;
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
/** 컨텍스트 상한 중 큰 값. 실제 상한은 용도별 상한과 min 을 취한다. */
export const DEFAULT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** 클레임 결과. leaseToken 이 이후 갱신·해제의 CAS 비교값이다. */
export interface ClaimedSession {
  sessionId: string;
  leaseToken: string;
}

/**
 * payload 는 접수 시점의 ProductRecord 다. 접수와 처리 사이에 배포가 끼면 워커가
 * 옛 형태를 읽을 수 있으므로, 창조 경로에 넘기기 전에 최소 형태를 확인한다.
 * 어긋나면 그 행만 실패시킨다 — 세션 전체를 막지 않는다.
 */
export function isProductRecord(value: unknown): value is ProductRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rowNumber === 'number' &&
    typeof v.productKey === 'string' &&
    typeof v.version === 'object' &&
    v.version !== null &&
    Array.isArray(v.categoryIds) &&
    Array.isArray(v.options) &&
    Array.isArray(v.variantOverrides) &&
    typeof v.basePrice === 'number' &&
    // errors 는 가드 통과 직후 .length 로 읽으므로 반드시 여기서 확인해야 한다.
    // 빠뜨리면 이 필드가 없는 payload 가 가드를 통과한 뒤 TypeError 를 던지고,
    // 그 예외가 runCommitSlice 를 탈출해 세션이 영원히 같은 행에서 재시도한다.
    Array.isArray(v.errors)
  );
}

@Injectable()
export class ProductImportJobManager {
  private readonly logger = new Logger(ProductImportJobManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly importManager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly config: ConfigService,
    private readonly reader: ProductImportSessionReader,
    private readonly versionsService: ProductVersionsService,
    private readonly imageFetcher: ProductImportImageFetcher,
    private readonly fileClient: ProductImportFileClient,
  ) {}

  private positiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  get commitSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_COMMIT_SLICE', DEFAULT_COMMIT_SLICE);
  }

  get publishSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_PUBLISH_SLICE', DEFAULT_PUBLISH_SLICE);
  }

  get leaseMs(): number {
    return this.positiveInt('PRODUCT_IMPORT_LEASE_MS', DEFAULT_LEASE_MS);
  }

  get imageSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_SLICE', DEFAULT_IMAGE_SLICE);
  }

  get imageFetchTimeoutMs(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_FETCH_TIMEOUT_MS', DEFAULT_IMAGE_FETCH_TIMEOUT_MS);
  }

  get imageMaxBytes(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_MAX_BYTES', DEFAULT_IMAGE_MAX_BYTES);
  }

  /**
   * commit 대기 세션 하나를 원자적으로 잡는다. lease 를 미래로 밀어 두므로
   * 롤링 배포로 태스크가 잠시 둘이어도 같은 세션을 겹쳐 처리하지 않는다.
   * running 을 다시 잡는 것은 재개 경로다 — lease 가 만료됐다는 건 처리하던
   * 프로세스가 죽었다는 뜻이고, 남은 pending 행부터 이어가면 된다.
   */
  async claimCommit(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('commit_status', tx);
  }

  /** claimCommit 과 같은 원자적 claim, publish_status 컬럼을 잡는다. */
  async claimPublish(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('publish_status', tx);
  }

  /** claimCommit 과 같은 원자적 claim, image_status 컬럼을 잡는다. */
  async claimImage(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('image_status', tx);
  }

  private async claim(
    column: 'image_status' | 'commit_status' | 'publish_status',
    tx?: DbTransaction,
  ): Promise<ClaimedSession | null> {
    // sql.raw 는 SQL 인젝션 경로지만 인자가 이 유니온 세 값뿐이라 외부 입력이 닿지 않는다.
    // 컬럼명은 바인딩할 수 없으므로 raw 외의 선택지가 없다.
    const statusColumn = sql.raw(column);
    // lease 소유권은 **토큰**으로 확인한다. 만료시각은 DB 시계가 만들게 두고(비교하지 않고
    // `lease_until < NOW()` 자격 판정에만 쓰므로 정밀도가 무관하다), 소유권은 uuid 등호로 본다.
    // 타임스탬프로 소유권을 보려던 앞선 세 번의 시도가 모두 정밀도·타임존·드라이버 직렬화에서
    // 깨졌다. 토큰은 문자열이라 raw sql 바인딩도 안전하다.
    const leaseToken = uuidv7();
    // `cancel_requested_at IS NULL` 가드는 오늘은 심층방어다 — cancelSession 이 레인도
    // 함께 'canceled' 로 뒤집으므로, 위 `IN ('queued', 'running')` 만으로도 취소된 세션은
    // 이미 걸러진다. 그래도 남겨두는 이유: 미래에 레인 상태를 바꾸지 않고
    // cancel_requested_at 만 찍는 경로가 생기면(예: 취소 요청만 먼저 기록하고 레인 전이는
    // 비동기로 미루는 설계 변경), 그 순간에도 굳은 세션의 재시도 루프를 끊어준다 —
    // 슬라이스 밖으로 탈출한 예외는 renewLease 에 도달하기도 전에 나므로 워커 쪽 취소
    // 감지만으로는 그 루프를 끊을 수 없다.
    // (이 주석은 sql 템플릿 밖에 둔다 — 템플릿 안 `--` 주석은 매 클레임마다 Postgres 로
    // 그대로 전송돼 pg_stat_activity 에 노이즈를 남긴다.)
    return this.db.run(async (trx) => {
      const rows = await trx.execute<{ id: string }>(sql`
        UPDATE product_import_sessions
           SET ${statusColumn} = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid
         WHERE id = (
           SELECT id
             FROM product_import_sessions
            WHERE ${statusColumn} IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
              AND cancel_requested_at IS NULL
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 배열 원소 타입까지
      // 좁혀주지 않는다. fulfillment-order-reservation-retry.worker.ts:111 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string }>;
      return row ? { sessionId: row.id, leaseToken } : null;
    }, tx);
  }

  /**
   * 클레임한 세션의 pending 행을 슬라이스만큼 처리한다.
   * 세션을 통째로 돌지 않는 이유는 스펙 §4.3.3 — 틱 길이를 유계로 두고, 재개를 공짜로
   * 만든다. 클레임은 `ORDER BY created_at LIMIT 1` 이고, 슬라이스가 끝나도 lease 만
   * 놓을 뿐 commit_status 는 running 그대로 두므로, 가장 오래된 세션이 끝날 때까지
   * 그 세션이 워커를 독점한다 — FIFO 지 교대 진행이 아니다. 한 틱 안에서도 claimCommit
   * 이 claimPublish 보다 항상 먼저 시도되므로(product-import-job.worker.ts), commit
   * 적체가 길면 publish 레인이 굶주릴 수 있다.
   */
  async runCommitSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productImportItems)
        .where(and(eq(productImportItems.sessionId, sessionId), eq(productImportItems.status, 'pending')))
        .orderBy(productImportItems.rowNumber)
        .limit(this.commitSlice),
    );

    if (items.length === 0) {
      await this.db.run((trx) =>
        trx
          .update(productImportSessions)
          .set({
            commitStatus: 'completed',
            leaseUntil: null,
            leaseToken: null,
            committedAt: new Date(),
            // 이전 슬라이스의 일시적 오류(recordJobError)가 남아있으면 세션이 정상 완료돼도
            // 지워지지 않는다 — publish 레인의 queuePublish 가 publishError 를 리셋하는 것과
            // 같은 이유로 commit 레인도 마감 시점에 지워야 한다.
            commitError: null,
          })
          // 마감도 renew·release 와 같은 토큰 CAS 를 건다. 무조건 쓰면, lease 가 만료된 뒤
          // 뒤늦게 깨어난 좀비가 pending 0 을 보고 **후임이 처리 중인 세션을** completed 로
          // 도장 찍고 committed_at 을 오늘로 덮어쓰며 후임의 lease_until 까지 지운다.
          // cancel 가드도 같은 계열이다 — 취소 직후 pending 이 0 인 경계에서 canceled 를
          // completed 로 덮는 것을 막는다.
          .where(
            and(
              eq(productImportSessions.id, sessionId),
              eq(productImportSessions.leaseToken, leaseToken),
              isNull(productImportSessions.cancelRequestedAt),
            ),
          ),
      );
      return;
    }

    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1),
    );
    const userId = session?.uploadedBy ?? '';

    // 접수 시점 검사와 실제 write 사이에 다른 파일이 코드를 선점했을 수 있다.
    // 슬라이스마다 한 번 더 봐서 창을 좁힌다 (슬라이스당 쿼리 1회).
    const records = items.map((item) => item.payload).filter(isProductRecord);
    await this.variantCodeChecker.check(records);

    // 세션 이미지 인덱스는 **슬라이스당 한 번**만 만든다. 행 수는 MAX_IMAGE_ROWS 로 유계고,
    // 이미지가 없는 세션이면 조회가 0행이라 비용이 없다.
    const imageIndex = indexSessionImages(await this.reader.getSessionImages(sessionId));

    for (const item of items) {
      // 행마다 lease 를 갱신한다. 클레임 때 한 번만 밀어두면 슬라이스가 lease 보다
      // 오래 걸릴 때 다른 워커가 같은 세션을 잡아 **아직 pending 인 같은 행을 함께
      // 처리한다** — 상품이 둘 생기고 createdCount 가 두 번 오른다.
      //
      // 갱신은 토큰 CAS 다. 실패했다는 건 이미 lease 를 빼앗겼다는 뜻이므로 **즉시 멈춘다** —
      // 계속 진행하면 후임 워커와 같은 행을 나란히 처리하게 된다. 가드는 반드시 두
      // continue 경로보다 위에 있어야 한다(어느 경로든 시간을 쓴다).
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        // 취소는 종단이다 — 레인 상태는 cancelSession 이 이미 확정했으므로 여기서는
        // lease 만 놓는다. 다음 틱의 claim 은 cancel_requested_at 가드에 막혀 이 세션을
        // 다시 집지 않는다.
        this.logger.log(`임포트 세션이 취소돼 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      const record = item.payload;
      if (!isProductRecord(record)) {
        await this.failItem(item.id, sessionId, '행 데이터 형식이 달라 처리할 수 없습니다. 파일을 다시 올려주세요.');
        continue;
      }
      if (record.errors.length > 0) {
        await this.failItem(
          item.id,
          sessionId,
          record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
        );
        continue;
      }

      // 참조한 이미지가 하나라도 못 올라왔으면 이 행은 실패다. 이미지 없이 만들면 그건
      // 이 단계가 없애려는 실패 모드 그대로이고, 게다가 조용하다 — 관리자는 상품을
      // 하나씩 열어보기 전엔 어디가 빠졌는지 모른다(계획 서두의 판단 1).
      const imageError = unresolvedImageError(record, imageIndex);
      if (imageError) {
        await this.failItem(item.id, sessionId, imageError);
        continue;
      }

      try {
        await this.db.run(async (trx) => {
          const masterId = await this.importManager.createFromRecord(record, userId, trx, imageIndex.fileIds);
          await trx
            .update(productImportItems)
            .set({ status: 'created', masterId })
            .where(eq(productImportItems.id, item.id));
          await trx
            .update(productImportSessions)
            .set({ createdCount: sql`${productImportSessions.createdCount} + 1` })
            .where(eq(productImportSessions.id, sessionId));
        });
      } catch (error) {
        this.logger.warn(`임포트 행 생성 실패 (session=${sessionId}, row=${item.rowNumber}): ${String(error)}`);
        await this.failItem(item.id, sessionId, error instanceof Error ? error.message : '알 수 없는 오류');
      }
    }

    // lease 만 놓는다. commit_status 는 running 그대로 두어 다음 틱이 이어받는다.
    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * 게시 슬라이스. commit 보다 작은 이유는 건당 outbox 이벤트 + 스냅샷 조립이 붙기
   * 때문이다 — 4단계(레인 강등) 이전까지 이 슬라이스가 유일한 완충이다.
   */
  async runPublishSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;
    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productImportItems)
        .where(
          and(
            eq(productImportItems.sessionId, sessionId),
            eq(productImportItems.status, 'created'),
            eq(productImportItems.publishStatus, 'pending'),
          ),
        )
        .orderBy(productImportItems.rowNumber)
        .limit(this.publishSlice),
    );

    if (items.length === 0) {
      await this.db.run((trx) =>
        trx
          .update(productImportSessions)
          // commit 마감과 같은 이유로 토큰 CAS 를 건다 — lease 를 잃은 좀비가
          // 후임의 세션에 completed 를 도장 찍고 lease 를 지우는 것을 막는다.
          .set({ publishStatus: 'completed', leaseUntil: null, leaseToken: null })
          .where(
            and(
              eq(productImportSessions.id, sessionId),
              eq(productImportSessions.leaseToken, leaseToken),
              isNull(productImportSessions.cancelRequestedAt),
            ),
          ),
      );
      return;
    }

    for (const item of items) {
      // commit 슬라이스와 같은 이유로 행마다 lease 를 갱신한다 — publishVersion 은
      // 가격검증 + 캐시 + 매칭 인계 + 스냅샷 조립이 붙어 행당 비용이 commit 보다 크다.
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 게시 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 게시 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      const { masterId } = item;
      if (!masterId) {
        await this.failPublish(item.id, sessionId, 'masterId 가 없어 게시할 수 없습니다.');
        continue;
      }

      try {
        const draftVersionId = await this.reader.getDraftVersionId(masterId);
        if (draftVersionId) {
          // 임포트 게시임을 이벤트에 남긴다 — channel-adapter 의 inbox 클레임이 이 표시로
          // 후순위 레인을 가른다(설계 스펙 §4.4). 단건 UI 게시에는 이 인자가 없다.
          await this.db.run((trx) =>
            this.versionsService.publishVersion(draftVersionId, trx, {
              origin: 'bulk_import',
              importSessionId: sessionId,
            }),
          );
        }
        // draft 가 없으면 이미 active 다 — 재실행에서 여기 오므로 published 로 마감한다(멱등).
        await this.db.run(async (trx) => {
          await trx
            .update(productImportItems)
            .set({ publishStatus: 'published', publishedAt: new Date(), publishError: null })
            .where(eq(productImportItems.id, item.id));
          await trx
            .update(productImportSessions)
            .set({ publishedCount: sql`${productImportSessions.publishedCount} + 1` })
            .where(eq(productImportSessions.id, sessionId));
        });
      } catch (error) {
        this.logger.warn(`임포트 행 게시 실패 (session=${sessionId}, master=${masterId}): ${String(error)}`);
        await this.failPublish(item.id, sessionId, error instanceof Error ? error.message : '알 수 없는 오류');
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * 이미지 레인 한 슬라이스. 두 phase 를 **한 레인**이 번갈아 돈다 —
   * `pending` 이 남아 있으면 probe, 없으면 `probed` 를 fetch, 둘 다 없으면 마감.
   * 레인을 둘로 쪼개지 않는 이유는 세션 상태 컬럼과 굶주림 경로가 함께 늘기 때문이다(스펙 §3.3).
   */
  async runImageSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const pending = await this.selectImages(sessionId, 'pending');
    if (pending.length > 0) {
      await this.runProbePhase(sessionId, leaseToken, pending);
      return;
    }

    const probed = await this.selectImages(sessionId, 'probed');
    if (probed.length > 0) {
      await this.runFetchPhase(sessionId, leaseToken, probed);
      return;
    }

    // 마감. **커밋 레인의 게이트를 여는 유일한 지점**이다(acceptCommit 이 'idle' 로 잠갔다).
    // 토큰 CAS + 취소 가드는 commit/publish 마감과 같은 이유다 — lease 를 잃은 좀비가
    // 후임의 세션에 completed 를 도장 찍고 lease 를 지우는 것을 막는다.
    //
    // commitStatus 를 조건 없이 'queued' 로 쓰는 것이 안전한 이유: 이미지가 있는 세션의
    // commit_status 는 acceptCommit 이 'idle' 로 넣은 뒤 이 지점 전까지 아무도 건드리지
    // 않고, 마감 후에는 image_status 가 'completed' 라 이 레인이 다시 클레임되지 않는다.
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({
          imageStatus: 'completed',
          commitStatus: 'queued',
          leaseUntil: null,
          leaseToken: null,
          imageError: null,
        })
        .where(
          and(
            eq(productImportSessions.id, sessionId),
            eq(productImportSessions.leaseToken, leaseToken),
            isNull(productImportSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  private selectImages(sessionId: string, status: 'pending' | 'probed') {
    return this.db.run((trx) =>
      trx
        .select()
        .from(productImportImages)
        .where(and(eq(productImportImages.sessionId, sessionId), eq(productImportImages.status, status)))
        // uuidv7 이라 id 순서가 곧 삽입 순서다 — 슬라이스가 항상 같은 순서로 나아간다.
        .orderBy(productImportImages.id)
        .limit(this.imageSlice),
    );
  }

  /**
   * probe — 바디를 받지 않고 도달 가능성만 본다. **동시성 1**(위 DEFAULT_IMAGE_SLICE 주석).
   * "probe 전량 완료"는 `count(status='pending') = 0` 으로 관측된다(진행률이 그걸 본다).
   */
  private async runProbePhase(
    sessionId: string,
    leaseToken: string,
    rows: Array<typeof productImportImages.$inferSelect>,
  ): Promise<void> {
    for (const row of rows) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      try {
        const result = await this.imageFetcher.probe(row.sourceUrl);
        await this.updateImage(row.id, {
          status: 'probed',
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 점검 실패 (session=${sessionId}, key=${row.imageKey}): ${message}`);
        await this.updateImage(row.id, { status: 'probe_failed', errorMessage: message });
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /** fetch — 바디를 받아 file-service 에 올린다. 크기 상한은 env 와 용도별 컨텍스트 상한의 min. */
  private async runFetchPhase(
    sessionId: string,
    leaseToken: string,
    rows: Array<typeof productImportImages.$inferSelect>,
  ): Promise<void> {
    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1),
    );
    const userId = session?.uploadedBy ?? '';

    for (const row of rows) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      // 업로드가 성공한 뒤 updateImage(...'uploaded'...) 가 던지면 이 행은 'probed' 로
      // 남고 file_id 는 그 행 자체엔 아직 안 쓰였다 — 재시도가 같은 이미지를 또 올려
      // 중복 객체를 만든다. catch 에서 이 값을 함께 남겨야 ProductImportImageCleaner 가
      // (§finding4 (a) 의 fileId IS NOT NULL 필터로) 그 파일을 찾아 지운다.
      let uploadedFileId: string | null = null;
      try {
        const maxBytes = Math.min(this.imageMaxBytes, MAX_BYTES_BY_USAGE[row.usage]);
        const fetched = await this.imageFetcher.fetch(row.sourceUrl, maxBytes, this.imageFetchTimeoutMs);
        const mimeType = fetched.mimeType ?? 'application/octet-stream';
        const uploaded = await this.fileClient.upload({
          body: fetched.body,
          fileName: this.uploadFileName(row.imageKey, row.sourceUrl),
          mimeType,
          usage: row.usage,
          userId,
        });
        uploadedFileId = uploaded.fileId;
        await this.updateImage(row.id, {
          status: 'uploaded',
          fileId: uploaded.fileId,
          mimeType,
          sizeBytes: fetched.sizeBytes,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 업로드 실패 (session=${sessionId}, key=${row.imageKey}): ${message}`);
        // updateImage 가 또 던질 수 있다 — 그건 슬라이스 밖 예외로 recordJobError 가
        // 세는 것이 맞으므로 여기서 추가로 감싸지 않는다.
        await this.updateImage(row.id, { status: 'fetch_failed', fileId: uploadedFileId, errorMessage: message });
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * file-service 가 originalname 에서 확장자를 뽑아 저장 파일명을 만든다(upload.service.ts:72).
   * 소스 URL 의 확장자를 살리되, 없거나 이상하면 `bin` 으로 둔다 — 저장 경로에만 쓰이고
   * MIME 판정은 콘텐츠 스니핑이 하므로 틀려도 업로드가 깨지지 않는다.
   */
  private uploadFileName(imageKey: string, sourceUrl: string): string {
    let extension = '';
    try {
      const path = new URL(sourceUrl).pathname;
      const match = /\.([a-zA-Z0-9]{1,5})$/.exec(path);
      extension = match ? match[1].toLowerCase() : '';
    } catch {
      extension = '';
    }
    // imageKey 는 워크북 입력이라 경로 구분자가 섞일 수 있다 — 파일명에 그대로 쓰지 않는다.
    const safeKey = imageKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safeKey}.${extension || 'bin'}`;
  }

  private async updateImage(imageId: string, patch: Partial<typeof productImportImages.$inferInsert>): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportImages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(productImportImages.id, imageId)),
    );
  }

  private async failPublish(itemId: string, sessionId: string, publishError: string): Promise<void> {
    await this.db.run(async (trx) => {
      await trx
        .update(productImportItems)
        .set({ publishStatus: 'failed', publishError })
        .where(eq(productImportItems.id, itemId));
      await trx
        .update(productImportSessions)
        .set({ publishFailedCount: sql`${productImportSessions.publishFailedCount} + 1` })
        .where(eq(productImportSessions.id, sessionId));
    });
  }

  /**
   * lease 를 다시 민다 — **내 토큰을 그대로 들고 있을 때만**(CAS).
   * `owned:false` 면 그 사이 lease 가 만료돼 다른 워커가 세션을 가져갔다는 뜻이고,
   * `canceled:true` 면 취소 요청이 들어왔다는 뜻이다. 둘 다 슬라이스 즉시 중단 사유다.
   *
   * 취소 여부를 **여기서** 읽는 이유: 이 왕복은 행마다 이미 돌고 있다 — returning 에
   * 컬럼 하나를 얹는 것은 쿼리를 늘리지 않는다(설계 스펙 §3.4.1).
   *
   * `lease_until > NOW()` 같은 *생존* 검사로는 부족하다. 후임 워커가 방금 민 lease 도
   * 미래이므로 그 조건을 통과한다 — 즉 정말 막아야 할 경우(후임이 넘겨받은 상태)에
   * 그대로 통과해 버려 아무 것도 막지 못한다. 소유권은 "내가 발급한 토큰"으로만 확인할 수 있다.
   */
  private async renewLease(sessionId: string, token: string): Promise<{ owned: boolean; canceled: boolean }> {
    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        // 만료시각은 DB 시계로 다시 민다 — 이 값은 비교 대상이 아니므로 정밀도가 무관하다.
        .set({ leaseUntil: sql`NOW() + ${this.leaseMs} * interval '1 millisecond'` })
        .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, token)))
        .returning({ cancelRequestedAt: productImportSessions.cancelRequestedAt }),
    );
    const [row] = rows;
    if (!row) return { owned: false, canceled: false };
    // Boolean() 으로 감싼다 — Date 는 truthy, null·undefined 는 falsy 다. `!== null` 로 쓰면
    // 값이 없는 목 하네스에서 undefined 가 취소로 오독된다.
    return { owned: true, canceled: Boolean(row.cancelRequestedAt) };
  }

  /** lease 를 놓는다 — 내 토큰을 그대로 들고 있을 때만(CAS). */
  private async releaseLease(sessionId: string, token: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ leaseUntil: null, leaseToken: null })
        .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, token))),
    );
  }

  private async failItem(itemId: string, sessionId: string, errorMessage: string): Promise<void> {
    await this.db.run(async (trx) => {
      await trx
        .update(productImportItems)
        // 생성이 실패했으면 게시 대상이 아니다 — pending 으로 두면 영영 안 끝난 것처럼 보인다.
        .set({ status: 'failed', publishStatus: 'skipped', errorMessage })
        .where(eq(productImportItems.id, itemId));
      await trx
        .update(productImportSessions)
        .set({ failedCount: sql`${productImportSessions.failedCount} + 1` })
        .where(eq(productImportSessions.id, sessionId));
    });
  }

  /**
   * 슬라이스를 탈출한 예외를 세션에 기록하고 **연속 실패를 센다.**
   *
   * 상한 전까지는 상태를 바꾸지 않는다 — 일시적 DB 오류로 임포트를 영구 실패시키는 편이
   * 더 나쁘다. lease 도 지우지 않는다: 예외가 났다는 건 우리가 지금 어떤 상태인지 모른다는
   * 뜻이고, 그 상태에서 lease 를 지우면 후임 워커의 lease 를 지울 수도 있다. 만료를
   * 기다리면 그만이다(최대 leaseMs).
   *
   * 상한에 닿으면 이야기가 달라진다 — 그 레인을 failed 로 확정하므로 claim 후보에서
   * 빠지고, 새 후임이 생기지 않는다. 그래서 이때만은 lease 를 지운다(토큰 CAS 없이):
   * 혹시 남아 있는 후임이 있다면 그 renewLease 가 실패해 스스로 멈추는데, 레인이 이미
   * failed 인 이상 그 중단이 옳은 방향이다. CAS 를 걸면 소유권이 옮겨간 순간 상한이
   * 영원히 발화하지 못한다.
   */
  async recordJobError(sessionId: string, kind: 'image' | 'commit' | 'publish', message: string): Promise<void> {
    const errorColumn =
      kind === 'image'
        ? { imageError: message }
        : kind === 'commit'
          ? { commitError: message }
          : { publishError: message };
    const failedColumn =
      kind === 'image'
        ? { imageStatus: 'failed' as const }
        : kind === 'commit'
          ? { commitStatus: 'failed' as const }
          : { publishStatus: 'failed' as const };

    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ ...errorColumn, consecutiveFailures: sql`${productImportSessions.consecutiveFailures} + 1` })
        .where(eq(productImportSessions.id, sessionId))
        .returning({ consecutiveFailures: productImportSessions.consecutiveFailures }),
    );

    const failures = rows[0]?.consecutiveFailures ?? 0;
    if (failures < MAX_CONSECUTIVE_JOB_FAILURES) return;

    this.logger.error(`임포트 잡이 ${failures}회 연속 실패해 ${kind} 레인을 failed 로 확정한다 (session=${sessionId})`);
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ ...failedColumn, leaseUntil: null, leaseToken: null })
        .where(eq(productImportSessions.id, sessionId)),
    );
  }

  /**
   * 슬라이스가 예외 없이 끝났으면 연속 실패를 0 으로 되돌린다. 리셋이 없으면 산발적
   * 오류가 누적돼 멀쩡한 세션이 언젠가 상한에 닿는다.
   *
   * `> 0` 조건을 붙여 흔한 경우(이미 0)에는 실제 행에 닿지 않게 한다 — 슬라이스마다 도는
   * 왕복이라 write 를 만들지 않는 편이 낫다.
   */
  async clearConsecutiveFailures(sessionId: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ consecutiveFailures: 0 })
        .where(and(eq(productImportSessions.id, sessionId), gt(productImportSessions.consecutiveFailures, 0))),
    );
  }
}
