import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError, ConflictError } from '@app/shared';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type PimSchema,
  productBulkSessions,
  productBulkItems,
  productBulkImages,
  productFormExportItems,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { classifyPublishError } from './bulk-publish.errors';
import { FormExportFileClient } from './form-export-file.client';
import { FormExportSnapshotReader, flattenCategoryTree } from './form-export.snapshot.reader';
import { createImageKeyAllocator } from './form-export.types';
import { PRICING_SENTINEL } from './form-export.sheets';
import { parseUploadWorkbook, type ParsedUpload } from './bulk-upload.parser';
import { assembleUpload, type AssembledRow } from './bulk-upload.assembler';
import { validateFields } from './bulk-session.validator';
import {
  buildCategoryPathIndex,
  checkOptionStructure,
  classifyImageSource,
  resolveCategories,
  resolveImageRefs,
  IMAGE_BEARING_PRODUCT_KEYS,
  type ImageBearingProductKey,
  type PrefilledImages,
} from './bulk-session.structure';
import { flattenBundle } from './bulk-session.fields';
import { computeChanges, detectConflicts } from './bulk-session.diff';
import { toConflictDecisionMap } from './bulk-session.reader';
import { BulkDraftApplier } from './bulk-draft.applier';
import { BulkVariantCodeChecker } from './bulk-variant-code.checker';
import type { ImageResolver } from './bulk-draft.fields';
import {
  formatRowError,
  formatRowErrors,
  isBulkBaseSnapshot,
  isBulkItemInput,
  isBulkItemPayload,
  isPrefillBundle,
  toPresentColumns,
  type BulkBaseSnapshot,
  type BulkItemInput,
  type BulkItemPayload,
  type ConflictMap,
  type FlatFields,
  type RowError,
} from './bulk-session.types';

/**
 * 60초. 파싱 슬라이스는 lease 를 중간에 갱신하지 않지만(다운로드+파싱은 쪼갤 수 없다)
 * 워크북 상한이 10MB(`MAX_UPLOAD_BYTES`)고 다운로드 자체에 30초 타임아웃이 걸려 있어
 * (form-export-file.client.ts) 한 번의 파싱이 이 값을 넘기기 어렵다. 검증 슬라이스는
 * **행마다** 갱신하므로 슬라이스 길이와 무관하다 — 1단계 양식 조립(30분)처럼 길게 잡을
 * 이유가 없고, 짧을수록 죽은 워커의 세션이 빨리 회수된다.
 */
export const DEFAULT_BULK_LEASE_MS = 60_000;
/** 한 틱에 검증할 행 수. 행마다 renderMaster(직렬 N+1 로더)가 붙어 임포트 커밋 슬라이스와 비슷한 무게다. */
export const DEFAULT_VALIDATE_SLICE = 20;
/** 한 틱에 draft 를 만들 행 수. publishVersion 만큼 무겁진 않지만 행마다 옵션·variant 되읽기가
 *  붙는다 — 검증 슬라이스(20)보다 작게 시작하고 실측으로 조정한다. */
export const DEFAULT_DRAFT_SLICE = 10;
/**
 * 한 틱에 발행할 행 수. `publishVersion` 한 건에 variantCode·productCode 유니크 검증,
 * 가격 검증, 가격 캐시 생성, 매칭 인계, asset link 인계, 이벤트 3종, sellable 재계산이
 * 전부 붙는다(스펙 §2.3) — draft 생성(10)보다 무겁다. 5에서 시작해 실측으로 조정한다.
 */
export const DEFAULT_PUBLISH_SLICE = 5;
/**
 * 슬라이스 밖으로 탈출한 예외의 연속 허용 횟수. 넘으면 세션을 failed 로 확정한다.
 *
 * 재시도 주기는 틱 간격(5초)이 아니다 — `recordJobError` 가 lease 를 의도적으로 지우지
 * 않으므로 다음 claim 은 `lease_until < NOW()` 에 막혀 leaseMs(기본 60초)를 기다린다.
 * 즉 10회는 최소 ~10분이고, 일시적 DB 오류·배포 중 커넥션 끊김은 그 안에 회복된다
 * (product-import-job.manager.ts:25-35 와 같은 근거·같은 값).
 */
export const MAX_CONSECUTIVE_BULK_FAILURES = 10;

/** `row_key`·`image_key` 는 둘 다 varchar(100) 이다(catalog.schema.ts). */
const KEY_MAX_LENGTH = 100;

/** 한 INSERT 문에 넣는 행 수. product-import.manager.ts:94 과 같은 값·같은 이유(파라미터 상한). */
const INSERT_CHUNK = 200;

/**
 * 파싱·검증·drafting·발행 레인이 다루는 phase. `recordJobError` 의 WHERE 에도 쓴다 — 이미
 * 레인을 벗어난 세션(review·canceled·failed…)을 뒤늦게 깨어난 좀비가 다시 건드리면 안 된다
 * (1단계 `TERMINAL_EXPORT_STATUSES` 와 같은 이유). `inArray` 가 mutable 배열을 요구해
 * `as const` 를 쓰지 않는다.
 */
const CLAIMABLE_PHASES: Array<'uploaded' | 'validating' | 'drafting' | 'publishing'> = [
  'uploaded',
  'validating',
  'drafting',
  'publishing',
];

const EXPORT_MISSING_MESSAGE = '이 세션의 기준 양식을 더 이상 찾을 수 없습니다. 양식을 다시 받아 작업한 뒤 올려주세요.';

/** 클레임 결과. `leaseToken` 이 이후 갱신·해제·마감의 CAS 비교값이다. */
export interface ClaimedBulkSession {
  sessionId: string;
  leaseToken: string;
  /** 'uploaded' 면 파싱, 'drafting' 이면 draft 슬라이스, 'publishing' 이면 발행 슬라이스,
   *  그 밖('validating')이면 검증 슬라이스다. */
  phase: string;
}

/** 양식 잡 items 에서 옮겨오는, 수정 행이 기준으로 삼는 값들. */
interface ExportBase {
  masterId: string;
  versionId: string;
  snapshot: unknown;
  /** `product_form_export_items.pricing_editable` — 얼린 판정의 **권위 있는 원본**. */
  pricingEditable: boolean;
}

/**
 * items 에 저장할 `base_snapshot` 하나를 만든다 — 양식 잡의 스냅샷 번들에 권위 있는
 * `pricingEditable` 을 얹는다(`BulkBaseSnapshot` 주석에 왜 얹는지가 있다).
 *
 * 형식이 다른 스냅샷은 **그대로 둔다**. 여기서 판단하지 않는 이유는 이 함수가 파싱
 * 슬라이스 안이라 실패시키면 세션 전체가 멈추기 때문이다 — `validateOne` 의 가드가 그 행
 * 하나만 invalid 로 굳히는 것이 옳은 처리다.
 */
function toBaseSnapshot(base: ExportBase): unknown {
  if (!isPrefillBundle(base.snapshot)) return base.snapshot;
  const snapshot: BulkBaseSnapshot = { ...base.snapshot, pricingEditable: base.pricingEditable };
  return snapshot;
}

/** 합성 아이템·형식 불일치 행이 쓰는 최소 `input`. `isBulkItemInput` 을 만족해야 되읽기가 죽지 않는다. */
function emptyInput(errors: RowError[]): BulkItemInput {
  return {
    bundle: { product: {}, options: [], variants: [], categories: [], constraint: null },
    present: { products: [], options: [], variants: [], categories: [], constraints: [] },
    errors,
  };
}

/**
 * 이 행이 쓸 이미지 해석기. 근거가 둘이다(F11):
 *   ① 세션 이미지 행 — 이 행이 **바꾼** 참조. 3단계가 fileId 로 해석해 뒀다
 *   ② base_snapshot.images — 수정 행이 **손대지 않은** 프리필 참조. 2단계 resolveImageRefs 가
 *      이런 참조를 refs 에 담지 않으므로 세션 이미지 행에도 없다
 * ①이 없을 때만 ②로 떨어진다 — 순서가 바뀌면 작업자가 방금 올린 새 파일 대신 옛 파일이 굳는다.
 *
 * export 하는 이유: 모듈 레벨 순수 함수라 `BulkSessionJobManager` 인스턴스 없이 단위로 잠글 수
 * 있고, "세션 행이 프리필을 이긴다"는 순서 규칙은 그 자체로 함정이라 직접 테스트가 필요하다
 * (Fix round 1 리뷰 Important 2).
 */
export function imageResolverFrom(
  item: typeof productBulkItems.$inferSelect,
  imageRows: Array<{ imageKey: string; usage: string; fileId: string | null }>,
): ImageResolver {
  const byKeyUsage = new Map<string, string>();
  for (const row of imageRows) {
    if (row.fileId) byKeyUsage.set(`${row.usage}:${row.imageKey}`, row.fileId);
  }
  const prefilled = isBulkBaseSnapshot(item.baseSnapshot) ? (item.baseSnapshot.images ?? {}) : {};

  return {
    fileIdFor: (imageKey, usage) => byKeyUsage.get(`${usage}:${imageKey}`) ?? prefilled[imageKey],
  };
}

@Injectable()
export class BulkSessionJobManager {
  private readonly logger = new Logger(BulkSessionJobManager.name);

  /** 오류 문구 상한. `error_message` 는 text 라 DB 제약은 아니지만, 스택이 통째로 실린 문자열이
   *  행 목록 API 에 그대로 나가는 것을 막는다(부록 A.8 인계). */
  private static readonly ERROR_MESSAGE_MAX = 500;

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly snapshot: FormExportSnapshotReader,
    private readonly categories: ProductCategoriesService,
    private readonly applier: BulkDraftApplier,
    private readonly versions: ProductVersionsService,
    private readonly config: ConfigService,
    private readonly variantCodes: BulkVariantCodeChecker,
  ) {}

  private positiveInt(key: string, fallback: number): number {
    const parsed = Number(this.config.get<string>(key));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  get leaseMs(): number {
    return this.positiveInt('PRODUCT_BULK_LEASE_MS', DEFAULT_BULK_LEASE_MS);
  }

  get validateSlice(): number {
    return this.positiveInt('PRODUCT_BULK_VALIDATE_SLICE', DEFAULT_VALIDATE_SLICE);
  }

  get draftSlice(): number {
    return this.positiveInt('PRODUCT_BULK_DRAFT_SLICE', DEFAULT_DRAFT_SLICE);
  }

  get publishSlice(): number {
    return this.positiveInt('PRODUCT_BULK_PUBLISH_SLICE', DEFAULT_PUBLISH_SLICE);
  }

  /**
   * 파싱·검증·drafting·발행 대상 세션 하나를 원자적으로 잡는다.
   *
   * `uploaded`·`validating`·`drafting`·`publishing` 을 넷 다 후보로 둔다 — 첫째는 첫 파싱,
   * 둘째는 이어서 검증, 셋째는 draft 생성, 넷째는 발행이다(또는 각 lease 가 만료된 재개).
   * `cancel_requested_at IS NULL` 가드는 취소된 세션을 다시 집지 않게 한다.
   *
   * product-import-job.manager.ts:148-192 의 claim 과 같은 알고리즘이다(컬럼만 다르다) —
   * lease 소유권은 이 레포에서 목이 초록인 채 세 번 깨졌고, 그때 얻은 결론이 "만료시각은
   * DB 시계가 만들고 소유권은 uuid 등호로 본다" 다.
   */
  async claim(tx?: DbTransaction): Promise<ClaimedBulkSession | null> {
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      const rows = await trx.execute<{ id: string; phase: string }>(sql`
        UPDATE product_bulk_sessions
           SET lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid,
               updated_at = NOW()
         WHERE id = (
           SELECT id
             FROM product_bulk_sessions
            WHERE phase IN ('uploaded', 'validating', 'drafting', 'publishing')
              AND (lease_until IS NULL OR lease_until < NOW())
              AND cancel_requested_at IS NULL
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id, phase
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 원소 타입까지
      // 좁혀주지 않는다 — form-export-job.manager.ts:97 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string; phase: string }>;
      return row ? { sessionId: row.id, leaseToken, phase: row.phase } : null;
    }, tx);
  }

  /**
   * 워크북을 내려받아 items·images 를 만들고 phase 를 validating 으로 민다.
   *
   * 슬라이스로 쪼개지 않는 이유: 파싱은 파일 하나를 통째로 읽는 일이라 중간 산출물이
   * 없다. 대신 **한 트랜잭션**에 넣어 재개가 공짜가 되게 한다 — 죽으면 통째로 다시 한다.
   * 토큰 CAS 를 트랜잭션의 **첫 문장**으로 둔다(1단계 runExport 가 이 순서를 뒤집었다가
   * 좀비가 후임의 items 를 덮어쓰는 데이터 손상을 냈다 — form-export-job.manager.ts:130).
   *
   * 다운로드·파싱은 **어떤 트랜잭션도 걸치지 않는다**. 10MB fetch 왕복 동안 살아있는
   * Postgres 트랜잭션을 붙잡고 있을 이유가 없다(bulk-session.manager.ts:72-88 과 같은 관례).
   */
  async runParseSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const [session] = await this.db.run((trx) =>
      trx
        .select({
          sourceFileId: productBulkSessions.sourceFileId,
          uploadedBy: productBulkSessions.uploadedBy,
          exportId: productBulkSessions.exportId,
        })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1),
    );
    if (!session) {
      this.logger.warn(`파싱할 일괄 세션을 찾지 못했습니다 (session=${sessionId})`);
      return;
    }

    if (!session.sourceFileId) {
      // 도달 불가여야 한다 — 만료 스윕은 종단 phase 만 비우고 파싱은 uploaded 전용이다.
      // 그래도 조용히 넘기지 않는다: NULL 을 만났다는 건 둘 중 하나의 전제가 깨졌다는 뜻이다.
      await this.failSession(sessionId, leaseToken, '업로드된 원본 파일을 찾을 수 없습니다. 다시 올려주세요.');
      return;
    }

    const buffer = await this.fileClient.download(session.sourceFileId, session.uploadedBy);

    // 파일 수준 오류는 재시도로 낫지 않는다 — 재업로드가 유일한 답이다(스펙 §3.12 파일 층).
    // 그래서 연속 실패 카운터를 태우지 않고 여기서 세션을 바로 failed 로 확정한다.
    // 다운로드 실패(네트워크·5xx)는 **여기서 잡지 않는다** — 그건 일시적일 수 있으므로
    // 워커의 recordJobError 가 세는 것이 맞다.
    let parsed: ParsedUpload;
    try {
      parsed = await parseUploadWorkbook(buffer);
    } catch (error) {
      if (!(error instanceof BadRequestError)) throw error;
      await this.failSession(sessionId, leaseToken, error.message);
      return;
    }

    // ─── 수정/신규 분류의 기준: 양식 잡 items ───
    //
    // 프리필 행을 신규로 재분류하면 카탈로그가 통째로 중복 생성된다(스펙 §3.1 ⚠️).
    // 접수 게이트(bulk-session.manager.ts 의 assertExportUsable)가 1차 방어선이고,
    // 아래 `else if (parsed.exportId)` 가 2차 방어선이다.
    //
    // **`exportItems.length === 0` 에는 일부러 가드를 두지 않는다.** 언뜻 "양식이 사라졌다"
    // 로 보이지만 그 사고의 최종 상태는 여기가 아니다 — 양식 잡이 만료 삭제되면
    // (form-export.manager.ts:118 의 purge) 세션 FK 가 `ON DELETE SET NULL` 이라
    // `export_id` 가 **NULL 이 되고** items 는 CASCADE 로 함께 사라지므로, 그 경로는 이
    // if 에 애초에 들어오지 못하고 아래 NULL 가지로 간다. 반대로 "export_id 살아있음 +
    // items 0행" 은 **정상 케이스**다: `renderMaster` 는 active 없는 master(draft 만 있는
    // 상품)를 조용히 건너뛰므로(form-export.snapshot.reader.ts:125), 그런 상품만 골라
    // 받은 양식은 `product_count: 0` 으로 정상 completed 된다. 접수 게이트도 그 양식을
    // 명시적으로 통과시킨다(bulk-session.manager.ts:184-187). 여기서 실패시키면 멀쩡한
    // 양식을 두고 "양식을 더 이상 찾을 수 없다"고 말하며 세션을 영구 실패시킨다.
    // 프리필 행이 정말 하나도 없었으므로 전 행이 `kind='create'` 가 되는 것은 오분류가
    // 아니라 사실이다.
    const knownRows = new Map<string, ExportBase>();
    // 지역 const 로 뽑는다 — 프로퍼티 접근의 null 좁힘은 아래 클로저 안에서 풀린다.
    const exportId = session.exportId;
    if (exportId) {
      const exportItems = await this.db.run((trx) =>
        trx
          .select({
            rowKey: productFormExportItems.rowKey,
            masterId: productFormExportItems.masterId,
            versionId: productFormExportItems.versionId,
            snapshot: productFormExportItems.snapshot,
            // 권위 있는 얼린 판정. 컬럼 하나를 더 읽는 대신, 검증기가 스냅샷 판매가 셀이
            // 센티넬인지로 역산하던 것을 통째로 없앤다(`BulkBaseSnapshot` 주석).
            pricingEditable: productFormExportItems.pricingEditable,
          })
          .from(productFormExportItems)
          .where(eq(productFormExportItems.exportId, exportId)),
      );
      for (const item of exportItems) {
        knownRows.set(item.rowKey, {
          masterId: item.masterId,
          versionId: item.versionId,
          snapshot: item.snapshot,
          pricingEditable: item.pricingEditable,
        });
      }
    } else if (parsed.exportId) {
      // **여기가 중복 생성의 진짜 방어선이다.** 세션의 export_id 는 NULL 인데 워크북은
      // exportId 를 들고 있다 = 접수 이후 양식 잡이 지워져 FK 가 SET NULL 로 끊긴 것이다.
      // 이걸 "신규 전용 세션"으로 읽으면 프리필된 행 전량이 신규 상품으로 재분류돼
      // 카탈로그가 통째로 중복 생성된다.
      //
      // 오탐이 구조적으로 불가능하다: accept() 는 워크북의 exportId 를 그대로 세션에
      // 넣고, 해석되지 않는 exportId 는 업로드 자체를 거부한다(bulk-session.manager.ts).
      // 따라서 이 조합은 **접수 이후 삭제**로만 만들어진다 — 진짜 빈 양식 업로드는
      // 워크북에도 exportId 가 없어 이 가지에 걸리지 않는다.
      await this.failSession(sessionId, leaseToken, EXPORT_MISSING_MESSAGE);
      return;
    }

    const assembled = assembleUpload(parsed, new Set(knownRows.keys()));

    const present: BulkItemInput['present'] = {
      products: [...parsed.present.products],
      options: [...parsed.present.options],
      variants: [...parsed.present.variants],
      categories: [...parsed.present.categories],
      constraints: [...parsed.present.constraints],
    };

    // row_key 는 (session_id, row_key) UNIQUE 이고 varchar(100) 이다. 상품키 누락·중복은
    // 접합기가 **행 오류로 표시하되 행 자체는 남기는** 흔한 작업자 실수라(bulk-upload.assembler.ts:44-57),
    // 원본 문자열을 그대로 넣으면 23505/22001 로 INSERT 전체가 죽고 세션이 영원히 같은
    // 지점에서 재시도한다. 저장용 키만 유일·유계로 바꾼다 — 오류 메시지는 원본 상품키를
    // 그대로 싣고(input.errors), 이 행들은 어차피 invalid 라 4단계가 집지 않는다.
    const usedRowKeys = new Set<string>();
    const storedRowKey = (preferred: string, fallback: string): string => {
      let candidate = preferred !== '' ? preferred.slice(0, KEY_MAX_LENGTH) : fallback;
      for (let n = 2; usedRowKeys.has(candidate); n += 1) candidate = `${fallback}#${n}`;
      usedRowKeys.add(candidate);
      return candidate;
    };

    const itemValues: Array<typeof productBulkItems.$inferInsert> = [];
    for (const row of assembled.rows) {
      const base = row.kind === 'update' ? knownRows.get(row.rowKey) : undefined;
      itemValues.push({
        sessionId,
        rowNumber: row.rowNumber,
        rowKey: storedRowKey(row.rowKey, `__row__:${row.rowNumber}`),
        kind: row.kind,
        masterId: base?.masterId ?? null,
        baseVersionId: base?.versionId ?? null,
        baseSnapshot: base ? toBaseSnapshot(base) : null,
        input: { bundle: row.bundle, present, errors: row.errors },
        // payload 는 NULL 로 둔다. 그게 "아직 검증 안 됨"의 유일한 표시다.
        payload: null,
        status: 'pending',
      });
    }

    // ─── 이미지 행 ───
    // **오류 없는 행이 참조하는 것만** 만든다 — 용도(main/description)는 참조 지점이 정하므로
    // 참조가 없으면 행을 만들 수 없다.
    const imageRows = new Map<string, typeof productBulkImages.$inferInsert>();
    const sheetErrors: RowError[] = [...assembled.errors];
    // 오류로 버려진 이미지키도 따로 센다. `imageRows` 만 보고 조기 continue 하면 버려진
    // 키는 거기 안 들어가므로, 같은 키를 참조하는 **다음 상품 행**에서 같은 오류가 또
    // push 돼 `__orphan__:이미지:4` 와 `…#2` 두 합성 아이템이 생긴다. 용도(main/description)
    // 를 키에 넣지 않는 이유: 이 오류들은 이미지 **시트 행**의 성질이라 어느 용도로
    // 참조되든 같은 한 줄이다 — usage 까지 넣으면 한 키를 두 용도로 참조한 파일에서
    // 같은 중복이 다시 난다.
    const failedImageKeys = new Set<string>();
    for (const row of assembled.rows) {
      if (row.errors.length > 0) continue;
      const { refs } = resolveImageRefs(row, assembled.images);
      for (const ref of refs) {
        const dedupeKey = `${ref.usage}:${ref.imageKey}`;
        if (imageRows.has(dedupeKey) || failedImageKeys.has(ref.imageKey)) continue;
        const source = assembled.images.get(ref.imageKey);
        if (!source) continue; // resolveImageRefs 가 이미 행 오류로 남겼다
        // image_key 도 varchar(100) 이다 — row_key 와 같은 이유로 여기서 막는다. 다만
        // 이미지키는 잘라 저장하면 참조와 어긋나므로 자르지 않고 이미지 시트 오류로 돌린다.
        if (ref.imageKey.length > KEY_MAX_LENGTH) {
          failedImageKeys.add(ref.imageKey);
          sheetErrors.push({
            sheet: '이미지',
            rowNumber: source.rowNumber,
            message: `이미지키는 ${KEY_MAX_LENGTH}자 이하여야 합니다 (현재 ${ref.imageKey.length}자).`,
          });
          continue;
        }
        const classified = classifyImageSource(source.sourceValue);
        if ('error' in classified) {
          failedImageKeys.add(ref.imageKey);
          sheetErrors.push({ sheet: '이미지', rowNumber: source.rowNumber, message: classified.error });
          continue;
        }
        imageRows.set(dedupeKey, {
          sessionId,
          imageKey: ref.imageKey,
          usage: ref.usage,
          sourceKind: classified.kind,
          sourceValue: source.sourceValue,
          // fileId 로 적힌 원본은 이미 file-service 에 있다 — 3단계가 더 할 일이 없다.
          fileId: classified.kind === 'file_id' ? source.sourceValue : null,
          status: classified.kind === 'file_id' ? 'resolved' : 'awaiting_upload',
        });
      }
    }

    // ─── 상품에 붙지 않는 시트 오류 → 합성 아이템 ───
    // 세션 전체를 실패시키지 않는 이유는 오타 한 줄 때문에 나머지 999행을 재업로드시키는
    // 것이 나쁘기 때문이고, 그렇다고 버리면 **조용히 무시된 참조**가 되어 작업자가 왜
    // 이미지가 빠졌는지 영영 모른다. 아이템 목록에 invalid 로 뜨는 것이 사람이 보는 자리다.
    for (const error of sheetErrors) {
      const key = `__orphan__:${error.sheet}:${error.rowNumber}`;
      itemValues.push({
        sessionId,
        rowNumber: error.rowNumber,
        rowKey: storedRowKey(key, key),
        kind: 'create',
        input: emptyInput([error]),
        // 검증 슬라이스는 `payload IS NULL` 로 대상을 고른다 — 값을 넣어 집히지 않게 한다.
        // `{}` 가 아니라 `{ fields: {} }` 인 이유: 이 shape 이어야 `isBulkItemPayload`
        // 가드도 함께 만족해, 3·4단계가 status 필터를 빠뜨려도 되읽기가 죽지 않는다.
        payload: { fields: {} } satisfies BulkItemPayload,
        status: 'invalid',
        errorMessage: formatRowError(error),
      });
    }

    await this.db.run(async (trx) => {
      // 마감 CAS 가 **첫 문장**이다. 0행이면 items 쪽 문장에 아예 도달하지 않는다.
      // lease 는 여기서 놓는다 — 다음 틱이 곧바로 검증 슬라이스로 이어받게 하기 위해서다
      // (붙잡고 있으면 만료까지 leaseMs 를 기다린다). 같은 트랜잭션 안이라 items 적재와
      // 원자적이다.
      const [row] = await trx
        .update(productBulkSessions)
        .set({
          phase: 'validating',
          phaseError: null,
          totalRows: assembled.rows.length,
          leaseUntil: null,
          leaseToken: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        )
        .returning({ id: productBulkSessions.id });

      if (!row) {
        // CAS 조건에는 취소 가드도 들어 있다 — 원인을 lease 하나로 단정하면 취소 직후의
        // 정상 경합을 운영자가 lease 사고로 오독한다.
        this.logger.warn(
          `일괄 세션의 lease 를 잃었거나 그 사이 취소돼 파싱 결과를 반영하지 못했습니다 (session=${sessionId})`,
        );
        return;
      }

      // 한 statement 에 다 넣지 않는다(파라미터 상한·문 크기) — items 는 행마다 input
      // 번들이 통째로 붙고 상품 행 상한이 1,000, 이미지 행 상한이 10,000 이다.
      // product-import.manager.ts:93-99 와 같은 이유·같은 청크 크기.
      for (let i = 0; i < itemValues.length; i += INSERT_CHUNK) {
        await trx.insert(productBulkItems).values(itemValues.slice(i, i + INSERT_CHUNK));
      }
      const imageValues = [...imageRows.values()];
      for (let i = 0; i < imageValues.length; i += INSERT_CHUNK) {
        await trx.insert(productBulkImages).values(imageValues.slice(i, i + INSERT_CHUNK));
      }
    });
  }

  /**
   * 아직 검증하지 않은 행(`payload IS NULL`)을 슬라이스만큼 검증한다.
   * 남은 행이 없으면 phase 를 review 로 민다.
   */
  async runValidateSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(and(eq(productBulkItems.sessionId, sessionId), isNull(productBulkItems.payload)))
        .orderBy(productBulkItems.rowNumber)
        .limit(this.validateSlice),
    );

    if (items.length === 0) {
      // review 로 넘기기 직전, 세션 전역 검사를 한 번 돈다. 여기가 유일한 자리다 — 슬라이스
      // 중간에 돌면 아직 검증 안 된 행의 코드를 못 보고, review 이후에 돌면 사람이 이미
      // 프리뷰를 다 본 뒤다.
      const flagged = await this.variantCodes.checkSession(sessionId);
      if (flagged > 0) {
        this.logger.log(`품목코드 중복으로 ${flagged}건을 invalid 로 표시했다 (session=${sessionId})`);
      }
      await this.finishValidating(sessionId, leaseToken);
      return;
    }

    // 카테고리 트리와 이미지 시트는 행과 무관한 세션 전역 참조라 슬라이스당 한 번만 읽는다.
    // 1단계 리더가 쓰는 것과 **같은** 평탄화를 쓴다(Task 2 가 export 로 열었다) — 양식에
    // 적힌 경로 문자열과 여기서 만드는 인덱스 키가 다르면 멀쩡한 경로가 전부 미해석이 된다.
    // includeInactive=true 인 것도 그대로다: 이미 비활성 카테고리에 배정된 상품의 경로가
    // 인덱스에서 빠지면, 카테고리를 건드리지도 않은 행이 통째로 오류가 된다.
    const refs = await this.db.run(async (trx) => {
      const tree = await this.categories.getCategoryTree(undefined, true, trx);
      const flat = flattenCategoryTree(tree.categories);
      const imageRows = await trx
        .select({ imageKey: productBulkImages.imageKey, sourceValue: productBulkImages.sourceValue })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId));
      return {
        pathIndex: buildCategoryPathIndex(flat),
        categoryPathById: new Map(flat.map((c) => [c.id, c.path])),
        // 파싱 슬라이스가 실제로 남긴 이미지만 담는다 — 시트에는 있었지만 URL·길이 오류로
        // 버려진 키를 참조한 행은 여기서 "이미지 시트에 없는 이미지키"로 잡혀야 한다.
        // rowNumber 는 resolveImageRefs 가 읽지 않으므로 0 으로 둔다(오류에 실리지 않는다).
        images: new Map(imageRows.map((r) => [r.imageKey, { rowNumber: 0, sourceValue: r.sourceValue }])),
      };
    });

    for (const item of items) {
      // 행마다 lease 를 갱신한다. 클레임 때 한 번만 밀어두면 슬라이스가 lease 보다 오래
      // 걸릴 때 다른 워커가 같은 세션을 잡아 **아직 payload 가 NULL 인 같은 행을 함께**
      // 처리한다. 갱신은 토큰 CAS 라, 실패했다는 건 이미 lease 를 빼앗겼다는 뜻이므로
      // 즉시 멈춘다 — 계속하면 후임과 같은 행을 나란히 처리하게 된다.
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`일괄 세션 lease 를 잃어 검증 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        // 취소는 종단이다 — phase 는 취소 경로가 확정하므로 여기서는 lease 만 놓는다.
        this.logger.log(`일괄 세션이 취소돼 검증 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      await this.validateOne(item, refs);
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * 한 행을 검증해 payload·conflict·status 를 확정한다.
   *
   * **어떤 경로로 끝나든 payload 를 쓴다** — `payload IS NULL` 이 "아직 검증 안 됨"의
   * 유일한 의미이고, 오류가 났다고 NULL 로 두면 그 행이 영원히 다시 검증돼 슬라이스가
   * 제자리를 돈다.
   */
  private async validateOne(
    item: typeof productBulkItems.$inferSelect,
    refs: {
      pathIndex: Map<string, string[]>;
      categoryPathById: Map<string, string>;
      images: Map<string, { rowNumber: number; sourceValue: string }>;
    },
  ): Promise<void> {
    // 접수와 검증 사이에 배포가 끼면 옛 코드가 쓴 input 을 읽을 수 있다 — 그때는 그 행만
    // 실패시킨다(세션 전체를 막지 않는다). product-import-job.manager.ts 의 isProductRecord
    // 가드와 같은 이유.
    if (!isBulkItemInput(item.input)) {
      await this.finishItem(item.id, { fields: {} }, null, [
        {
          sheet: '상품',
          rowNumber: item.rowNumber,
          message: '행 데이터 형식이 달라 처리할 수 없습니다. 파일을 다시 올려주세요.',
        },
      ]);
      return;
    }

    const input = item.input;
    const row: AssembledRow = {
      rowNumber: item.rowNumber,
      rowKey: item.rowKey,
      kind: item.kind,
      bundle: input.bundle,
      errors: input.errors,
    };

    // 접합 단계 오류가 이미 있으면 그대로 invalid 로 굳힌다 — 상품키가 없거나 겹친 행은
    // 뒤 검사를 통과해도 어차피 적용할 수 없다.
    if (input.errors.length > 0) {
      await this.finishItem(item.id, { fields: {} }, null, input.errors);
      return;
    }

    // 수정 행이 기준으로 쓰는 두 값을 한 객체로 묶어 둔다 — 따로 두면 아래 클로저에서
    // `item.masterId` 의 null 좁힘이 풀려 캐스팅을 써야 한다.
    let updateBase: { masterId: string; snapshot: BulkBaseSnapshot } | null = null;
    if (item.kind === 'update') {
      const masterId = item.masterId;
      if (!masterId || !isBulkBaseSnapshot(item.baseSnapshot)) {
        await this.finishItem(item.id, { fields: {} }, null, [
          {
            sheet: '상품',
            rowNumber: item.rowNumber,
            message: '기준 스냅샷이 없어 수정 행을 검증할 수 없습니다. 양식을 다시 받아 주세요.',
          },
        ]);
        return;
      }
      updateBase = { masterId, snapshot: item.baseSnapshot };
    }

    // 수정 행의 "가격을 임포트로 표현할 수 있는가"는 **양식 다운로드 시점에 얼린 판정**을
    // 쓴다. 지금 룰을 다시 판정하면 그 사이 누가 가격 룰을 바꿨을 때 워크북에 찍힌 센티넬과
    // 어긋난다(스펙 §3.8). 신규 행은 항상 true.
    //
    // 얼린 값의 **권위 있는 원본은 `product_form_export_items.pricing_editable` 컬럼**이고,
    // 파싱 슬라이스가 그것을 `base_snapshot` 에 실어 온다. `??` 뒤의 센티넬 역산은 이 필드를
    // 싣기 전 코드가 쓴 행을 위한 폴백일 뿐이다 — 파싱과 검증 사이에 배포가 끼는 창에서만
    // 탄다. (역산을 유일한 경로로 두면 `PRICING_SENTINEL` 문자열을 바꾸는 날 이미 저장된
    // 스냅샷 전부에서 판정이 조용히 뒤집힌다.)
    const pricingEditable = updateBase
      ? (updateBase.snapshot.pricingEditable ?? updateBase.snapshot.product.basePrice !== PRICING_SENTINEL)
      : true;

    const errors: RowError[] = [...validateFields(row, { pricingEditable })];
    const present = toPresentColumns(input.present);

    let fields: FlatFields;
    let conflicts: ConflictMap = {};
    if (updateBase) {
      const { masterId, snapshot: baseSnapshot } = updateBase;
      // '현재 active' 는 **스냅샷의 이미지 키 배정을 seed 로 넣어** 다시 그린다. 안 넣으면
      // 안 바뀐 이미지가 IMG-1 부터 다시 번호를 받아 이미지를 건드리지도 않은 행이 전부
      // 충돌로 뜬다(form-export.types.ts 의 createImageKeyAllocator 주석).
      const current = await this.db.run((trx) =>
        this.snapshot.renderMaster(trx, masterId, createImageKeyAllocator(baseSnapshot.images), refs.categoryPathById),
      );
      if (!current) {
        await this.finishItem(item.id, { fields: {} }, null, [
          { sheet: '상품', rowNumber: item.rowNumber, message: '기준 상품의 판매 중인 버전을 찾을 수 없습니다.' },
        ]);
        return;
      }

      errors.push(...checkOptionStructure(input.bundle, baseSnapshot));

      const base = flattenBundle(baseSnapshot);
      const mine = flattenBundle(input.bundle, present);
      fields = computeChanges(base, mine);
      conflicts = detectConflicts(base, mine, flattenBundle(current));
    } else {
      // 신규 행은 비교 대상이 없다 — 파일에 있던 값 전체가 그대로 적용분이다.
      fields = flattenBundle(input.bundle, present);
    }

    const payload: BulkItemPayload = { fields };

    // 이미지 참조 해석은 **무엇이 바뀌었는지를 알고** 한다. 안 건드린 프리필 참조는 이미지
    // 시트가 통째로 없어도 오류가 아니다 — 파서가 그 시트 부재를 허용하는데(필수는 '상품'
    // 시트뿐) 여기서 전 행 실패로 뒤집으면 관용이 무의미해진다. 근거는 `base_snapshot.images`
    // 가 들고 있다(imageKey → fileId). 자세한 규약은 `resolveImageRefs` 독스트링.
    const prefilledImages: PrefilledImages | undefined = updateBase
      ? {
          keys: new Set(Object.keys(updateBase.snapshot.images ?? {})),
          unchanged: new Set<ImageBearingProductKey>(
            IMAGE_BEARING_PRODUCT_KEYS.filter((key) => !(`product.${key}` in fields)),
          ),
        }
      : undefined;
    const imageRefs = resolveImageRefs(row, refs.images, prefilledImages);
    errors.push(...imageRefs.errors);
    if (imageRefs.refs.length > 0) payload.imageRefs = imageRefs.refs;

    // 카테고리는 `category.set` 이 적용분에 있을 때만 해석한다 — 수정 행에서 카테고리를
    // 건드리지 않았으면 해석할 것도, 오류를 낼 것도 없다.
    if ('category.set' in fields) {
      const resolved = resolveCategories(input.bundle.categories, refs.pathIndex);
      errors.push(...resolved.errors);
      payload.categoryIds = resolved.categoryIds;
      if (resolved.primaryCategoryId) payload.primaryCategoryId = resolved.primaryCategoryId;
    }

    await this.finishItem(item.id, payload, Object.keys(conflicts).length > 0 ? conflicts : null, errors);
  }

  /** 검증 결과를 행에 굳힌다. 오류가 없으면 pending(=적용 대기), 있으면 invalid. */
  private async finishItem(
    itemId: string,
    payload: BulkItemPayload,
    conflict: ConflictMap | null,
    errors: RowError[],
  ): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkItems)
        .set({
          payload,
          conflict,
          status: errors.length > 0 ? 'invalid' : 'pending',
          errorMessage: errors.length > 0 ? formatRowErrors(errors) : null,
          updatedAt: new Date(),
        })
        .where(eq(productBulkItems.id, itemId)),
    );
  }

  /**
   * `status='pending'` 인 행을 슬라이스만큼 draft 로 만든다. 남은 행이 없으면 phase 를
   * drafted 로 민다.
   *
   * **행 하나가 트랜잭션 하나다.** 슬라이스를 통째로 감싸면 한 행의 22001 이 앞선 성공까지
   * 되돌린다. 행 단위로 끊으면 실패 격리가 공짜로 오고, **DB 안에서는** 롤백이 진짜 롤백이다 —
   * v3 의 고아 master 행이 구조적으로 없다. (그 근거는 `draftOne` 이 `apply()` 와 상태갱신을
   * **같은 트랜잭션**에 묶는 데 있다 — master 생성과 "이 행이 그 master 를 안다"는 사실이 같은
   * 커밋에 실려, 커밋 전에 워커가 죽어도 고아 master 가 남지 않는다.)
   *
   * **다만 "phantom masterId 가 완전히 사라진다"는 아니다**(최종 리뷰 정정, 스펙 §5.1). 롤백돼도
   * `createMaster` 가 낸 두 부수효과는 남는다: 브로커로 직송된 `ProductVariantCreated` Kafka
   * 이벤트(`product-masters.service.ts:136` → `stream-publisher.service.ts:209` — 아웃박스가
   * 아니다)와, `tx` 를 전파받지 않아 독립 커밋되는 `product_matchings` 행
   * (`product-masters.service.ts:167` → `product-matching.service.ts:272,297`). 이 브랜치의
   * 회귀가 아니라 v1·v3 와 공유하는 `createMaster` 의 기존 동작이다.
   */
  async runDraftSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'pending')))
        .orderBy(productBulkItems.rowNumber)
        .limit(this.draftSlice),
    );

    if (items.length === 0) {
      await this.finishDrafting(sessionId, leaseToken);
      return;
    }

    // 이미지 해석 결과는 행과 무관한 세션 전역 참조라 슬라이스당 한 번만 읽는다.
    const imageRows = await this.db.run((trx) =>
      trx
        .select({
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId)),
    );

    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1),
    );
    if (!session) {
      this.logger.warn(`draft 를 만들 일괄 세션을 찾지 못했습니다 (session=${sessionId})`);
      return;
    }

    for (const item of items) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`일괄 세션 lease 를 잃어 draft 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`일괄 세션이 취소돼 draft 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      await this.draftOne(sessionId, session.uploadedBy, item, imageResolverFrom(item, imageRows));
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * `status='drafted'` ∧ `publish_status='pending'` 인 행을 슬라이스만큼 발행한다.
   * 남은 행이 없으면 phase 를 published 로 민다.
   *
   * **실패 행이 남아 있어도 published 로 마감한다** — 세션 차원의 일은 끝났고, 남은 것은
   * 그 행들의 재시도(`queuePublish` 재호출)나 제외다(스펙 §10.4).
   *
   * 행 하나가 트랜잭션 하나인 이유는 `runDraftSlice` 와 같다 — 한 행의 실패가 앞선 성공을
   * 되돌리면 안 된다. 다만 여기서 되돌아가지 **않는** 것이 하나 있다: 발행이 커밋되면
   * 카탈로그가 이미 바뀐 것이라 취소로 되돌릴 수 없다(스펙 §3.12 — 취소는 published 를
   * 덮지 않는다).
   */
  async runPublishSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            eq(productBulkItems.status, 'drafted'),
            eq(productBulkItems.publishStatus, 'pending'),
          ),
        )
        .orderBy(productBulkItems.rowNumber)
        .limit(this.publishSlice),
    );

    if (items.length === 0) {
      await this.finishPublishing(sessionId, leaseToken);
      return;
    }

    for (const item of items) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`일괄 세션 lease 를 잃어 발행 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`일괄 세션이 취소돼 발행 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      await this.publishOne(sessionId, item);
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * 행 하나를 자기 트랜잭션에서 발행한다. 관문 넷의 **순서가 계약이다**(스펙 §10.4).
   *
   * ① 세션 행 FOR UPDATE + 취소 재확인 — 루프의 `renewLease` 는 값싼 앞단 필터일 뿐이다.
   *    그 검사와 이 커밋 사이에 취소가 커밋되면 "취소했는데 상품이 발행됨"이 된다.
   *    `cancel()` 의 CAS UPDATE 가 같은 세션 행을 잠그므로 두 순서 모두 안전해진다.
   *    (3단계 bulk-image.manager.ts:190, 4단계 draftOne 과 같은 형태·같은 이유)
   * ② 행 상태 재확인 — ①과 같은 창에서 `excludeItem` 이 이 행을 뺐을 수 있다. 제외도
   *    세션 행을 잠그므로 여기까지 오면 결정은 이미 확정돼 있다.
   * ③ 발행 시점 가드 — `현재 active.id === draft.parentVersionId`. 다르면 그 사이 남이
   *    발행했다는 뜻이고, 그대로 발행하면 남의 변경이 통째로 사라진다(스펙 §2.2·§3.10).
   * ④ 잠금 해제 후 발행 — `publishVersion` 이 잠긴 draft 를 409 로 거부하므로 같은
   *    트랜잭션에서 먼저 푼다(스펙 §10.3). 실패하면 롤백돼 잠금이 되살아나 재시도가 된다.
   */
  private async publishOne(sessionId: string, item: typeof productBulkItems.$inferSelect): Promise<void> {
    const draftVersionId = item.draftVersionId;
    if (!draftVersionId) {
      await this.failPublish(item.id, '생성된 draft 가 없어 발행할 수 없습니다.');
      return;
    }

    try {
      await this.db.run(async (trx) => {
        // ① 취소 재확인
        const [locked] = await trx
          .select({ cancelRequestedAt: productBulkSessions.cancelRequestedAt })
          .from(productBulkSessions)
          .where(eq(productBulkSessions.id, sessionId))
          .for('update');
        if (!locked || Boolean(locked.cancelRequestedAt)) {
          this.logger.log(`일괄 세션이 취소돼 이 행을 발행하지 않는다 (session=${sessionId}, item=${item.id})`);
          return;
        }

        // ② 행 상태 재확인 (제외·중복 발행 방지)
        const [current] = await trx
          .select({ status: productBulkItems.status, publishStatus: productBulkItems.publishStatus })
          .from(productBulkItems)
          .where(eq(productBulkItems.id, item.id));
        if (!current || current.status !== 'drafted' || current.publishStatus !== 'pending') return;

        const version = await this.versions.getVersionById(draftVersionId, trx);

        // 멱등: 재시도로 다시 온 행이 이미 발행돼 있으면 도장만 찍는다.
        if (version.status === 'active') {
          await trx
            .update(productBulkItems)
            .set({ publishStatus: 'published', publishError: null, updatedAt: new Date() })
            .where(eq(productBulkItems.id, item.id));
          return;
        }

        // ③ 발행 시점 가드
        let currentActiveId: string | null = null;
        try {
          const active = await this.versions.getActiveVersion(version.masterId, trx);
          currentActiveId = active.id;
        } catch (error) {
          // active 가 **없는 것**만 신규 행의 정상 상태다(getActiveVersion 은 이때
          // NotFoundException 을 던진다 — product-versions.service.ts:141). 그 밖의 오류
          // (커넥션 끊김·statement timeout)를 여기서 삼키면 두 가지로 배신한다: 수정 행은
          // 멀쩡한데 "기준이 변경되었습니다"로 죽고, 신규 행(parentVersionId=null)은
          // currentActiveId 가 null 이 되어 **가드를 그냥 통과한다** — 관문 ③ 이 막으려던
          // 바로 그 사고다. 그래서 되던진다 — 바깥 catch 가 classifyPublishError 로 분류해
          // 그 행만 정직하게 실패시킨다.
          if (!(error instanceof NotFoundException)) throw error;
          currentActiveId = null;
        }
        if (currentActiveId !== (version.parentVersionId ?? null)) {
          throw new ConflictError('기준이 변경되었습니다. 이 상품은 양식을 다시 받아 작업해 주세요.');
        }

        // ④ 잠금 해제 → 발행
        await trx
          .update(productMasterVersions)
          .set({ bulkSessionId: null, updatedAt: new Date() })
          .where(eq(productMasterVersions.id, draftVersionId));

        await this.versions.publishVersion(draftVersionId, trx, {
          origin: 'bulk_import',
          importSessionId: sessionId,
        });

        await trx
          .update(productBulkItems)
          .set({ publishStatus: 'published', publishError: null, updatedAt: new Date() })
          .where(eq(productBulkItems.id, item.id));
      });
    } catch (error) {
      // 행 층 오류는 그 행만 죽인다. 원문은 로그로만 남기고 화면에는 분류된 문구를 준다.
      this.logger.warn(
        `일괄 세션 행 발행 실패 (session=${sessionId}, item=${item.id}): ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.failPublish(item.id, classifyPublishError(error));
    }
  }

  /** 발행 실패를 그 행에만 적는다. 문구는 이미 분류·절단된 것이 온다. */
  private async failPublish(itemId: string, message: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkItems)
        .set({
          publishStatus: 'failed',
          publishError: message.slice(0, BulkSessionJobManager.ERROR_MESSAGE_MAX),
          updatedAt: new Date(),
        })
        .where(eq(productBulkItems.id, itemId)),
    );
  }

  /**
   * 발행 대기 행이 없으면 세션을 published 로 넘긴다.
   * 토큰 CAS + 취소 가드는 `finishDrafting` 과 같은 이유다(F6).
   */
  private async finishPublishing(sessionId: string, leaseToken: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ phase: 'published', phaseError: null, leaseUntil: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  /**
   * 행 하나를 자기 트랜잭션에서 draft 로 만든다. `apply()` 성공과 그 결과를 행에 적는 것은
   * **한 트랜잭션**이다(§runDraftSlice 독스트링) — 실패는 별도 트랜잭션(`failItem`)으로
   * **그 행에만** 적는다.
   *
   * 그 트랜잭션의 첫 문장은 세션 행 `SELECT … FOR UPDATE` + 취소 재확인이다(본문 주석) —
   * 루프의 `renewLease` 는 그 앞단의 값싼 필터일 뿐이고, 미아 draft 를 실제로 막는 것은
   * 이 잠금이다.
   */
  private async draftOne(
    sessionId: string,
    userId: string,
    item: typeof productBulkItems.$inferSelect,
    images: ImageResolver,
  ): Promise<void> {
    // 되읽기 가드. 롤링 배포에서 옛 코드가 쓴 payload 를 만나면 그 행만 실패시킨다
    // (validateOne 의 isBulkItemInput 가드와 같은 이유).
    if (!isBulkItemPayload(item.payload)) {
      await this.failItem(item.id, '행 데이터 형식이 달라 처리할 수 없습니다. 파일을 다시 올려주세요.');
      return;
    }
    // 로컬 const 로 뽑는다 — `item.payload` 의 가드 좁힘은 아래 db.run 콜백(별개 함수 스코프)
    // 안에서 풀린다. 로컬 바인딩은 재대입이 없다는 걸 컴파일러가 증명할 수 있어 클로저
    // 안에서도 좁힌 타입이 유지된다(toBaseSnapshot 의 updateBase 클로저와 같은 이유).
    const payload = item.payload;

    try {
      // apply() 와 상태갱신을 **한 트랜잭션**으로 묶는다. 둘로 쪼개면 커밋 사이에 워커가
      // 죽었을 때(롤링 배포의 task stop 이 정확히 이 창을 때린다) 행은 pending 으로 남고,
      // 다음 틱이 같은 행을 다시 처리해 `applyCreate` 의 무조건 `createMaster` 가 master 를
      // 한 벌 더 만든다 — 앞의 master 는 어떤 item 도 가리키지 않는 고아가 된다. 하나로
      // 묶으면 이 창이 구조적으로 없다: master 생성과 "그 master 를 이 행이 안다"는 사실이
      // 같은 커밋에 실리므로, 커밋이 안 됐으면 master 도 없다(진짜 롤백).
      await this.db.run(async (trx) => {
        // ─── 취소 레이스의 마지막 방어선 (최종 리뷰 ①) ───
        //
        // 세션 행을 **이 트랜잭션의 첫 문장으로** 잠그고 취소를 다시 읽는다. 위 루프의
        // `renewLease` 검사만으로는 부족하다: 그 검사와 이 트랜잭션의 커밋 사이에 취소가
        // 커밋되면, 이 행의 draft 는 `bulk_session_id` 를 단 채 커밋된다. 그런데
        // `cancel()` 의 잠금 해제 UPDATE(`WHERE bulk_session_id = :sessionId`)는 아직
        // 커밋되지 않은 그 draft 를 볼 수 없고, 그 뒤 이 값을 지우는 경로가 레포에 없다 —
        // `claim()` 은 취소된 세션을 다시 집지 않고 `cancel()` 은 `phase='canceled'` 에
        // 409 를 던진다. 결과는 발행·삭제·재취소가 전부 막히고 my-drafts 에도 안 나오는
        // **영구 미아 draft** 이고, 탈출구가 수기 SQL 뿐이다.
        //
        // `cancel()` 의 CAS UPDATE 가 같은 세션 행을 잠그므로 두 순서 모두 안전해진다:
        // 우리가 먼저 잠그면 취소가 커밋을 기다렸다가 우리 draft 를 보고 풀어 주고,
        // 취소가 먼저 잠그면 우리가 여기서 기다렸다가 취소를 보고 아무것도 쓰지 않는다.
        // 잠그는 행이 하나(같은 세션)라 잠금 순서가 단일해 교착이 없다 —
        // `bulk-image.manager.ts:192` 의 3단계 선례와 같은 형태다.
        //
        // **실패로도 기록하지 않는다.** 취소된 세션의 행은 실패한 것이 아니다.
        const [locked] = await trx
          .select({ cancelRequestedAt: productBulkSessions.cancelRequestedAt })
          .from(productBulkSessions)
          .where(eq(productBulkSessions.id, sessionId))
          .for('update');
        // Boolean() 으로 감싸는 이유는 `renewLease` 와 같다 — Date 는 truthy, null 은 falsy.
        if (!locked || Boolean(locked.cancelRequestedAt)) {
          this.logger.log(`일괄 세션이 취소돼 이 행의 draft 를 만들지 않는다 (session=${sessionId}, item=${item.id})`);
          return;
        }

        const result = await this.applier.apply(
          {
            sessionId,
            userId,
            kind: item.kind,
            masterId: item.masterId,
            payload,
            // 신규 행의 옵션 그룹 귀속은 원본 시트 행에서만 복원된다(Task 4 리뷰). 형식이 다르면
            // 빈 배열로 떨어뜨린다 — 그 행은 어차피 옵션 없는 상품으로 처리되고, 옵션을 참조하는
            // 조합이 있으면 checkCreateStructure 가 "없는 옵션값키"로 잡아 그 행만 실패시킨다.
            optionRows: isBulkItemInput(item.input) ? item.input.bundle.options : [],
            // 신규 행의 "같은 조합 두 번" 검사(checkCreateStructure)가 평면화 이전 원본을
            // 봐야 하므로 조합 시트 행도 그대로 넘긴다(Task 10). 형식이 다르면 optionRows 와
            // 같은 이유로 빈 배열 — 그 행은 어차피 다른 되읽기 가드에서 이미 걸린다.
            variantRows: isBulkItemInput(item.input) ? item.input.bundle.variants : [],
            conflictDecision: toConflictDecisionMap(item.conflictDecision),
            baseSnapshot: isBulkBaseSnapshot(item.baseSnapshot) ? item.baseSnapshot : null,
            images,
          },
          trx,
        );

        await trx
          .update(productBulkItems)
          .set({
            status: 'drafted',
            draftVersionId: result.draftVersionId,
            masterId: result.masterId,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(productBulkItems.id, item.id));
      });
    } catch (error) {
      // 행 층 오류는 그 행만 죽인다(스펙 §3.12). 레인 층(슬라이스 밖 탈출)은 워커의
      // recordJobError 가 센다 — 여기서 삼키므로 draft 실패는 연속 실패 상한을 태우지 않는다.
      // 그것이 맞다: 1,000행 중 30행이 실패해도 세션은 계속 나아가야 한다.
      //
      // **원문은 로그로만 남기고 화면에는 분류된 문구를 준다** — `publishOne` 의 catch 와
      // 같은 관례다. 최종 리뷰 발견 ②: 이 catch 가 지금까지 `classifyPublishError` 를 전혀
      // 부르지 않고 예외 원문(영어 DB 오류 포함)을 그대로 `error_message` 에 실었다 — §10.7
      // 이 "닫았다"고 적은 `errorMessage` 분류는 실은 발행 실패(`publishOne`)에만 걸려 있었고
      // draft 생성 실패(여기)는 빠져 있었다. §3.12 가 "생성 시 22001" 을 행 오류로 명시하는데
      // 그 가장 흔한 사고가 여전히 관리자 화면에 그대로 떴다는 뜻이다.
      this.logger.warn(
        `일괄 세션 행 draft 생성 실패 (session=${sessionId}, item=${item.id}): ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.failItem(item.id, classifyPublishError(error, '생성'));
    }
  }

  /** 행 층 오류를 그 행에만 적는다. 문구는 이미 분류·절단된 것이 온다. `error_message` 는
   *  상한을 잘라 관리자 화면 렌더를 보호한다(호출부가 이미 분류해도, 방어적으로 다시 자른다). */
  private async failItem(itemId: string, message: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkItems)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, BulkSessionJobManager.ERROR_MESSAGE_MAX),
          updatedAt: new Date(),
        })
        .where(eq(productBulkItems.id, itemId)),
    );
  }

  /**
   * 미검증 행이 없으면 세션을 review 로 넘긴다.
   *
   * 토큰 CAS + 취소 가드는 1단계·임포트 마감과 같은 이유다 — 무조건 쓰면 lease 가 만료된
   * 뒤 뒤늦게 깨어난 좀비가 "미검증 0" 을 보고 **후임이 처리 중인 세션에** review 를 도장
   * 찍고 후임의 lease 까지 지운다. 취소 가드는 취소 직후 경계에서 canceled 를 review 로
   * 덮는 것을 막는다.
   */
  private async finishValidating(sessionId: string, leaseToken: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ phase: 'review', phaseError: null, leaseUntil: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  /**
   * 미착수 행(`status='pending'`)이 없으면 세션을 drafted 로 넘긴다.
   *
   * 토큰 CAS + 취소 가드는 `finishValidating` 과 같은 이유다 — 무조건 쓰면 뒤늦게 깨어난
   * 좀비가 후임이 처리 중인 세션에 drafted 를 도장 찍고 후임의 lease 까지 지운다.
   */
  private async finishDrafting(sessionId: string, leaseToken: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ phase: 'drafted', phaseError: null, leaseUntil: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  /**
   * 재시도로 낫지 않는 오류(파일 층·기준 양식 소실)를 세션에 확정한다.
   *
   * 토큰 CAS 를 거는 이유는 마감과 같다. 취소 가드도 함께 건다 — 취소된 세션을 failed 로
   * 덮으면 사람이 누른 취소가 사라진다.
   */
  private async failSession(sessionId: string, leaseToken: string, message: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ phase: 'failed', phaseError: message, leaseUntil: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  /**
   * lease 를 다시 민다 — **내 토큰을 그대로 들고 있을 때만**(CAS).
   * `owned:false` 면 그 사이 lease 가 만료돼 다른 워커가 세션을 가져갔다는 뜻이고,
   * `canceled:true` 면 취소 요청이 들어왔다는 뜻이다. 둘 다 슬라이스 즉시 중단 사유다.
   *
   * 취소 여부를 여기서 읽는 이유: 이 왕복은 행마다 이미 돌고 있다 — returning 에 컬럼
   * 하나를 얹는 것은 쿼리를 늘리지 않는다.
   *
   * `lease_until > NOW()` 같은 *생존* 검사로는 부족하다. 후임 워커가 방금 민 lease 도
   * 미래이므로 그 조건을 통과한다 — 즉 정말 막아야 할 경우에 그대로 통과해 아무 것도
   * 막지 못한다. 소유권은 "내가 발급한 토큰"으로만 확인할 수 있다.
   */
  private async renewLease(sessionId: string, token: string): Promise<{ owned: boolean; canceled: boolean }> {
    const rows = await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        // 만료시각은 DB 시계로 다시 민다 — 이 값은 비교 대상이 아니므로 정밀도가 무관하다.
        .set({ leaseUntil: sql`NOW() + ${this.leaseMs} * interval '1 millisecond'` })
        .where(and(eq(productBulkSessions.id, sessionId), eq(productBulkSessions.leaseToken, token)))
        .returning({ cancelRequestedAt: productBulkSessions.cancelRequestedAt }),
    );
    const [row] = rows;
    if (!row) return { owned: false, canceled: false };
    // Boolean() 으로 감싼다 — Date 는 truthy, null·undefined 는 falsy 다. `!== null` 로 쓰면
    // 값이 없는 목 하네스에서 undefined 가 취소로 오독된다.
    return { owned: true, canceled: Boolean(row.cancelRequestedAt) };
  }

  /** lease 를 놓는다 — 내 토큰을 그대로 들고 있을 때만(CAS). phase 는 그대로 두어 다음 틱이 이어받는다. */
  private async releaseLease(sessionId: string, token: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ leaseUntil: null, leaseToken: null })
        .where(and(eq(productBulkSessions.id, sessionId), eq(productBulkSessions.leaseToken, token))),
    );
  }

  /**
   * 슬라이스를 탈출한 예외를 세션에 기록하고 **연속 실패를 센다.**
   *
   * 상한 전까지는 phase 를 바꾸지 않는다 — 일시적 DB 오류로 세션을 영구 실패시키는 편이
   * 더 나쁘다. lease 도 지우지 않는다: 예외가 났다는 건 우리가 지금 어떤 상태인지 모른다는
   * 뜻이고, 그 상태에서 lease 를 지우면 후임 워커의 lease 를 지울 수도 있다.
   *
   * 상한에 닿으면 세션을 failed 로 확정하므로 claim 후보에서 빠진다 — 그래서 이때만은
   * lease 를 지운다(토큰 CAS 없이). CAS 를 걸면 소유권이 옮겨간 순간 상한이 영원히
   * 발화하지 못한다(product-import-job.manager.ts:675-688 과 같은 근거).
   *
   * WHERE 에 `phase IN ('uploaded','validating','drafting')` 을 거는 것은 1단계
   * `TERMINAL_EXPORT_STATUSES` 와 같은 이유다 — 이미 review 로 넘어갔거나 취소·실패로
   * 종결된 세션을 뒤늦게 깨어난 좀비의 예외가 다시 실패로 끌어내리면 안 된다.
   */
  async recordJobError(sessionId: string, message: string): Promise<void> {
    await this.db.run(async (trx) => {
      const [row] = await trx
        .update(productBulkSessions)
        .set({
          phaseError: message,
          consecutiveFailures: sql`${productBulkSessions.consecutiveFailures} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(productBulkSessions.id, sessionId), inArray(productBulkSessions.phase, CLAIMABLE_PHASES)))
        .returning({ failures: productBulkSessions.consecutiveFailures });

      if (row && row.failures >= MAX_CONSECUTIVE_BULK_FAILURES) {
        await trx
          .update(productBulkSessions)
          .set({ phase: 'failed', leaseUntil: null, leaseToken: null, updatedAt: new Date() })
          .where(eq(productBulkSessions.id, sessionId));
        this.logger.error(`일괄 세션이 ${row.failures}회 연속 실패해 failed 로 확정됐습니다 (session=${sessionId})`);
      }
    });
  }

  /**
   * 슬라이스가 예외 없이 끝났으면 연속 실패를 0 으로 되돌린다. 리셋이 없으면 산발적
   * 오류가 누적돼 멀쩡한 세션이 언젠가 상한에 닿는다. `> 0` 조건을 붙여 흔한 경우(이미 0)
   * 에는 실제 행에 닿지 않게 한다 — 슬라이스마다 도는 왕복이라 write 를 만들지 않는 편이 낫다.
   */
  async clearConsecutiveFailures(sessionId: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ consecutiveFailures: 0 })
        .where(and(eq(productBulkSessions.id, sessionId), gt(productBulkSessions.consecutiveFailures, 0))),
    );
  }
}
