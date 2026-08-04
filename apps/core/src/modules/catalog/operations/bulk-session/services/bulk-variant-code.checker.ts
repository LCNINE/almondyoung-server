import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkItems,
  productVariants,
  productMasterVariants,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { isBulkItemPayload } from './bulk-session.types';

/** 세션 안에서 코드 하나를 주장한 행 하나. */
interface Claim {
  itemId: string;
  rowNumber: number;
  masterId: string | null;
}

/**
 * 세션 전역 `variantCode` 중복 사전검사(스펙 §10.7). v3 `ProductImportVariantCodeChecker`
 * 를 이 세션 모델로 옮긴 것이다.
 *
 * **행 단위가 아니라 세션 단위인 이유**: 검증 레인은 슬라이스로 쪼개지므로 인메모리 맵이
 * 틱을 넘어 살아남지 못한다(v3 가 같은 이유로 파이프라인 단계에 뒀다). 그래서 검증 슬라이스가
 * "남은 행 0" 을 본 순간, review 로 넘기기 **직전에** 한 번만 전량을 훑는다.
 *
 * **`status='pending'` 인 행만 본다.** 이미 invalid 인 행은 어차피 draft 가 되지 않으므로
 * 코드를 주장하지 않고, 여기서 손대지 않으므로 재실행(lease 만료로 슬라이스가 다시 도는
 * 경우)이 같은 문구를 겹쳐 쌓지 않는다 — 멱등성이 이 조건 하나에 걸려 있다.
 *
 * **자기 master 가 이미 쓰는 코드는 통과시킨다.** 수정 행이 자기 variant 들 사이에서 코드를
 * 옮기는 것은 정상이고, 같은 버전 안의 진짜 중복은 발행 시점
 * `_validateVariantCodeUniqueness` 가 그 행만 실패시킨다(스펙 §5.2 와 같은 성질).
 *
 * ⚠️ 남는 경합: 이 검사와 실제 발행 사이에 다른 세션이 같은 코드를 선점할 수 있다. 좁히기만
 * 하고 닫지는 못한다 — DB 유니크로 닫으려면 정션 join 이 필요해 partial index 로 불가능하다
 * (ADR-0004).
 */
@Injectable()
export class BulkVariantCodeChecker {
  /** 문구 상한. 기존 오류에 이어 붙이므로 합쳐서 이 길이를 넘지 않게 자른다. */
  private static readonly ERROR_MESSAGE_MAX = 500;
  /** postgres 파라미터 상한을 피하는 조회 청크. v3 checker 와 같은 값이다. */
  private static readonly CODE_CHUNK = 1000;

  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  /** @returns 오류를 새로 붙인 행 수 */
  async checkSession(sessionId: string, tx?: DbTransaction): Promise<number> {
    return this.db.run(async (trx) => {
      // 1. status='pending' 인 행만 읽는다 — 이미 invalid 인 행은 코드를 주장하지 않고,
      //    여기서 손대지 않아야 재실행이 문구를 겹쳐 쌓지 않는다.
      const items = await trx
        .select({
          id: productBulkItems.id,
          rowNumber: productBulkItems.rowNumber,
          masterId: productBulkItems.masterId,
          payload: productBulkItems.payload,
          errorMessage: productBulkItems.errorMessage,
        })
        .from(productBulkItems)
        .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'pending')));

      // 2. payload.fields 에서 variant:*.variantCode 키의 빈 문자열이 아닌 값을 모은다.
      //
      // **조합키 부분은 `(.*)`(0자 이상)여야 한다 — `(.+)` 였던 것을 Task 12 실 DB 통합
      // 스위트가 잡았다.** 옵션 없는 상품의 단일 기본 조합은 조합키가 빈 문자열이 계약이라
      // (F3, `bulk-session.fields.ts` 의 `parseFieldPath` 가 같은 이유로 이미 `(.*)` 를
      // 쓴다) 그 키는 `variant:.variantCode` 가 된다. `.+` 로 최소 1자를 요구하면 옵션 없는
      // (가장 흔한) 상품의 품목코드 중복 사전검사가 조용히 전부 빠진다 — 유닛 스펙은 늘
      // 조합키가 있는 픽스처만 썼기 때문에 이 갭을 못 잡았다.
      const claims = new Map<string, Claim[]>();
      const errorMessageById = new Map<string, string | null>();
      for (const item of items) {
        errorMessageById.set(item.id, item.errorMessage);
        if (!isBulkItemPayload(item.payload)) continue;
        for (const [key, value] of Object.entries(item.payload.fields)) {
          if (!/^variant:.*\.variantCode$/.test(key)) continue;
          if (!value) continue;
          const bucket = claims.get(value) ?? [];
          bucket.push({ itemId: item.id, rowNumber: item.rowNumber, masterId: item.masterId });
          claims.set(value, bucket);
        }
      }

      if (claims.size === 0) return 0;

      const appended = new Map<string, string[]>();
      const addMessage = (itemId: string, message: string): void => {
        const list = appended.get(itemId) ?? [];
        list.push(message);
        appended.set(itemId, list);
      };

      // 3. 세션 안 중복 — 버킷 크기 ≥ 2 면 어느 쪽이 맞는지 알 수 없으므로 관련 행 전부에 붙인다.
      for (const [code, bucket] of claims) {
        if (bucket.length < 2) continue;
        const rows = bucket.map((b) => `${b.rowNumber}행`).join(', ');
        const message = `[조합] 품목코드가 파일 안에서 중복됩니다: ${code} (${rows})`;
        for (const claim of bucket) addMessage(claim.itemId, message);
      }

      // 4. DB 전역 중복 — 코드를 1,000개씩 잘라 code → masterId[] 를 얻는다. 자기 masterId 가
      //    아닌 소유자가 있을 때만 오류다(자기 master 안에서 코드를 옮기는 것은 정상 업무).
      const codes = [...claims.keys()];
      const ownersByCode = new Map<string, Set<string>>();
      for (let i = 0; i < codes.length; i += BulkVariantCodeChecker.CODE_CHUNK) {
        const chunk = codes.slice(i, i + BulkVariantCodeChecker.CODE_CHUNK);
        const rows = await trx
          .selectDistinct({ variantCode: productVariants.variantCode, masterId: productMasterVersions.masterId })
          .from(productVariants)
          .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
          .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
          .where(and(inArray(productVariants.variantCode, chunk), eq(productMasterVersions.status, 'active')));
        for (const row of rows) {
          if (!row.variantCode) continue;
          const owners = ownersByCode.get(row.variantCode) ?? new Set<string>();
          owners.add(row.masterId);
          ownersByCode.set(row.variantCode, owners);
        }
      }

      for (const [code, bucket] of claims) {
        const owners = ownersByCode.get(code);
        if (!owners || owners.size === 0) continue;
        for (const claim of bucket) {
          const hasOtherOwner = [...owners].some((ownerId) => ownerId !== claim.masterId);
          if (!hasOtherOwner) continue;
          addMessage(claim.itemId, `[조합] 품목코드를 이미 사용 중인 상품이 있습니다: ${code}`);
        }
      }

      // 5. 굳히기 — 기존 문구 뒤에 이어 붙인다(기존이 null 이면 새 문구만), 500자로 자른다.
      let flagged = 0;
      for (const [itemId, messages] of appended) {
        const existing = errorMessageById.get(itemId) ?? null;
        const joined = messages.join('; ');
        const combined = existing ? `${existing}; ${joined}` : joined;
        await trx
          .update(productBulkItems)
          .set({
            status: 'invalid',
            errorMessage: combined.slice(0, BulkVariantCodeChecker.ERROR_MESSAGE_MAX),
            updatedAt: new Date(),
          })
          .where(eq(productBulkItems.id, itemId));
        flagged += 1;
      }

      return flagged;
    }, tx);
  }
}
