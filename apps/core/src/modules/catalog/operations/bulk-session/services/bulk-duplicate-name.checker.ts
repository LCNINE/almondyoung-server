import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkItems,
  productMasters,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { isBulkItemPayload } from './bulk-session.types';

/** 세션 안에서 상품명 하나를 주장한 행 하나. */
interface Claim {
  itemId: string;
  rowNumber: number;
}

/**
 * 신규 등록 행의 **상품명 중복 사전검사**(이슈 #630).
 *
 * 양식 없는 신규 세션에는 중복 방어가 없었다 — 같은 워크북을 두 번 올리면 같은 상품이 두 벌
 * 생긴다. 품번(`AY-####`)은 발행 때마다 새로 발번되므로(`product-versions.service.ts` 의
 * `MAX(product_code)+1`) 품번 유니크 제약이 구조적으로 발동하지 않는다. 2026-08-11 live 에서
 * 같은 파일 4회 업로드로 잉여 master 149개가 생겼다.
 *
 * `BulkVariantCodeChecker` 와 **같은 자리·같은 규약**이다(그쪽 독스트링에 근거가 다 있다):
 * 검증 슬라이스가 "남은 행 0" 을 본 순간 review 로 넘기기 직전 한 번, `status='pending'` 인
 * 행만, 오류 문구를 이어 붙이고 invalid 로 굳힌다.
 *
 * **`kind='create'` 만 본다.** 수정 행의 상품명은 자기 master 의 이름이라 항상 걸린다.
 *
 * ponytail: 판정 키는 **상품명 하나**다. 이슈는 "상품명 + 옵션 구성" 을 제안했지만, 옵션 구성을
 * 맞추려면 후보 master 마다 옵션·조합을 되읽어야 하고 정작 잡으려는 사고(같은 파일 재업로드)는
 * 이름만으로 전부 걸린다. 오탐(같은 이름의 진짜 다른 상품)은 상품명을 구분해 다시 올리거나 그
 * 상품만 개별 등록으로 처리한다 — 오탐이 실제로 잦아지면 그때 옵션 구성을 키에 더한다.
 *
 * ⚠️ 남는 경합: 이 검사와 발행 사이에 다른 세션이 같은 이름을 먼저 발행할 수 있다. 좁히기만
 * 하고 닫지는 못한다(`BulkVariantCodeChecker` 와 같은 성질).
 */
@Injectable()
export class BulkDuplicateNameChecker {
  /** 문구 상한. 기존 오류에 이어 붙이므로 합쳐서 이 길이를 넘지 않게 자른다. */
  private static readonly ERROR_MESSAGE_MAX = 500;
  /** postgres 파라미터 상한을 피하는 조회 청크. `BulkVariantCodeChecker` 와 같은 값이다. */
  private static readonly NAME_CHUNK = 1000;
  /** 오류 문구에 싣는 기존 상품 수. 전부 실으면 500자 상한을 한 행이 다 먹는다. */
  private static readonly PREVIEW_LIMIT = 3;

  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  /** @returns 오류를 새로 붙인 행 수 */
  async checkSession(sessionId: string, tx?: DbTransaction): Promise<number> {
    return this.db.run(async (trx) => {
      const items = await trx
        .select({
          id: productBulkItems.id,
          rowNumber: productBulkItems.rowNumber,
          payload: productBulkItems.payload,
          errorMessage: productBulkItems.errorMessage,
        })
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            eq(productBulkItems.status, 'pending'),
            eq(productBulkItems.kind, 'create'),
          ),
        );

      // 상품명은 정규화하지 않고 그대로 비교한다 — 파서가 셀을 이미 trim 하고, 잡으려는 것은
      // 같은 파일의 재업로드라 문자열이 글자 그대로 같다.
      const claims = new Map<string, Claim[]>();
      const errorMessageById = new Map<string, string | null>();
      for (const item of items) {
        errorMessageById.set(item.id, item.errorMessage);
        if (!isBulkItemPayload(item.payload)) continue;
        const name = item.payload.fields['product.name'];
        if (!name) continue;
        const bucket = claims.get(name) ?? [];
        bucket.push({ itemId: item.id, rowNumber: item.rowNumber });
        claims.set(name, bucket);
      }

      if (claims.size === 0) return 0;

      const appended = new Map<string, string[]>();
      const addMessage = (itemId: string, message: string): void => {
        const list = appended.get(itemId) ?? [];
        list.push(message);
        appended.set(itemId, list);
      };

      // 파일 안 중복 — 신규 행 둘이 같은 이름을 주장하면 어느 쪽이 맞는지 알 수 없으므로 둘 다.
      for (const [name, bucket] of claims) {
        if (bucket.length < 2) continue;
        const rows = bucket.map((b) => `${b.rowNumber}행`).join(', ');
        for (const claim of bucket)
          addMessage(claim.itemId, `[상품] 상품명이 파일 안에서 중복됩니다: ${name} (${rows})`);
      }

      // DB 전역 중복 — soft delete 된 상품은 제외한다. 삭제는 `product_masters.deleted_at` 에
      // 찍히고 버전 status 는 'active' 로 남으므로(product-masters.service.ts 의 deleteMaster),
      // status 만 보면 이미 지운 상품 때문에 재등록이 막힌다.
      const names = [...claims.keys()];
      const ownersByName = new Map<string, string[]>();
      for (let i = 0; i < names.length; i += BulkDuplicateNameChecker.NAME_CHUNK) {
        const chunk = names.slice(i, i + BulkDuplicateNameChecker.NAME_CHUNK);
        const rows = await trx
          .selectDistinct({
            name: productMasterVersions.name,
            productCode: productMasterVersions.productCode,
            masterId: productMasterVersions.masterId,
          })
          .from(productMasterVersions)
          .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
          .where(
            and(
              inArray(productMasterVersions.name, chunk),
              eq(productMasterVersions.status, 'active'),
              isNull(productMasters.deletedAt),
            ),
          );
        for (const row of rows) {
          const owners = ownersByName.get(row.name) ?? [];
          owners.push(row.productCode ?? row.masterId);
          ownersByName.set(row.name, owners);
        }
      }

      for (const [name, bucket] of claims) {
        const owners = ownersByName.get(name);
        if (!owners || owners.length === 0) continue;
        const preview = owners.slice(0, BulkDuplicateNameChecker.PREVIEW_LIMIT).join(', ');
        const more =
          owners.length > BulkDuplicateNameChecker.PREVIEW_LIMIT
            ? ` 외 ${owners.length - BulkDuplicateNameChecker.PREVIEW_LIMIT}건`
            : '';
        const message = `[상품] 같은 상품명으로 판매 중인 상품이 이미 있습니다: ${preview}${more}. 같은 파일을 다시 올린 것이 아니라면 상품명을 구분해 주세요.`;
        for (const claim of bucket) addMessage(claim.itemId, message);
      }

      let flagged = 0;
      for (const [itemId, messages] of appended) {
        const existing = errorMessageById.get(itemId) ?? null;
        const joined = messages.join('; ');
        const combined = existing ? `${existing}; ${joined}` : joined;
        await trx
          .update(productBulkItems)
          .set({
            status: 'invalid',
            errorMessage: combined.slice(0, BulkDuplicateNameChecker.ERROR_MESSAGE_MAX),
            updatedAt: new Date(),
          })
          .where(eq(productBulkItems.id, itemId));
        flagged += 1;
      }

      return flagged;
    }, tx);
  }
}
