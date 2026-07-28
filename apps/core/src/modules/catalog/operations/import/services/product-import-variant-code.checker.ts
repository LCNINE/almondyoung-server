import { Injectable } from '@nestjs/common';
import { ProductRecord } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';
import { ProductImportSessionReader } from './product-import-session.reader';

/**
 * variantCode 충돌을 파이프라인 단계에서 잡는다 — 파일 안 중복과 DB 전역 중복 양쪽.
 *
 * 이 검사가 manager.commit() 의 인메모리 맵이 아니라 여기 있는 이유가 둘이다.
 * (1) 커밋이 슬라이스로 쪼개지면(3단계) 인메모리 맵은 틱을 넘어 살아남지 못한다.
 * (2) 여기 있으면 /validate 프리뷰에서도 충돌이 보인다 — 커밋을 눌러야 알던 것을
 *     업로드 즉시 안다.
 *
 * ⚠️ 남는 경합: 접수 시점 검사와 실제 write(워커) 사이에 다른 파일이 같은 코드를
 * 선점할 수 있다. Task 6 이 슬라이스마다 같은 검사를 한 번 더 돌려 창을 좁히지만
 * 완전히 닫지는 못한다. DB 유니크 제약으로 닫으려면 "active 버전에 매달린 variant
 * 끼리만 unique" 를 표현해야 하는데 정션 join 이 필요해 partial index 로 불가능하다
 * (ADR-0004).
 */
@Injectable()
export class ProductImportVariantCodeChecker {
  constructor(private readonly reader: ProductImportSessionReader) {}

  async check(records: ProductRecord[], tx?: DbTransaction): Promise<void> {
    const claims = new Map<string, Array<{ record: ProductRecord; rowNumber: number }>>();

    for (const record of records) {
      for (const override of record.variantOverrides) {
        const code = override.variantCode;
        if (!code) continue;
        const bucket = claims.get(code) ?? [];
        bucket.push({ record, rowNumber: override.rowNumber });
        claims.set(code, bucket);
      }
    }

    if (claims.size === 0) return;

    // 파일 안 중복 — 어느 쪽이 맞는지 알 수 없으므로 양쪽 다 오류로 남긴다.
    for (const [code, bucket] of claims) {
      if (bucket.length < 2) continue;
      const rows = bucket.map((b) => `${b.rowNumber}행`).join(', ');
      for (const { record, rowNumber } of bucket) {
        record.errors.push({
          sheet: 'Variants',
          rowNumber,
          message: `variantCode 가 파일 안에서 중복됩니다: ${code} (${rows})`,
        });
      }
    }

    const existing = await this.reader.findActiveVariantCodes([...claims.keys()], tx);
    for (const code of existing) {
      for (const { record, rowNumber } of claims.get(code) ?? []) {
        record.errors.push({
          sheet: 'Variants',
          rowNumber,
          message: `variantCode 를 이미 사용 중인 상품이 있습니다: ${code}`,
        });
      }
    }
  }
}
