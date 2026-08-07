import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { productMasterVariants } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { type OptionPlan } from './bulk-draft.options';
import { parseFieldPath } from './bulk-session.fields';
import { type FlatFields } from './bulk-session.types';

/** 옵션 그룹·값 표시명을 읽을 로케일. form-export.snapshot.reader.ts 와 같은 값 — 워크북이 이 로케일로만 채워진다. */
const LOCALE = 'ko-KR';

/** (그룹명, 값명) 쌍의 맵 키. NUL 구분자를 쓰는 이유는 표시명 자체에 공백이 흔해서다 —
 *  단순 공백 결합이면 그룹 "A B" 값 "C" 와 그룹 "A" 값 "B C" 가 같은 키로 충돌한다. */
function namePairKey(groupName: string, valueName: string): string {
  return [groupName, valueName].join('\u0000');
}

/**
 * (Task 7) 조합키(수정 행의 idKey / 신규 행의 워크북 이름 키) → 실제 variantId 를 푸는
 * 공용 해석기. 원래 `BulkDraftApplier` 의 private 메서드였다 — 발행 경로(Task 8)가 같은
 * 해석을 다시 써야 해서 복제 대신 여기로 옮겼다. 로직은 옮기며 바꾸지 않았다(순수 이동).
 */
@Injectable()
export class BulkSessionComboResolver {
  constructor(private readonly optionLoader: OptionReadLoader) {}

  /**
   * 워크북 조합키(`variant:<조합>.*` 의 scopeKey) → 실제 variantId.
   *
   * F7 의 4단계: (1) `getOptionGroups` 로 (그룹명, 값명) → 실제 optionValueId 맵을 만들고,
   * (2) 워크북 조합키(작업자가 지은 옵션값키들의 결합)를 `plan.valueNameByKey` 로 이름을
   * 찾은 뒤 (1)의 맵으로 실제 id 로 바꿔 정렬 조인한 "id 키"를 만들고, (3)
   * `productMasterVariants` 의 variant 마다 `getVariantOptionValues` 로 같은 방식의 id 키를
   * 만들어 (2)와 매칭한다.
   *
   * **옵션이 없는 상품은 variant 가 하나이고 조합키가 빈 문자열이다**(F3,
   * form-export.snapshot.reader.ts:263-271) — 그 계약을 살리기 위해 combo === '' 는 이름
   * 조회 없이 곧장 id 키 '' 로 취급한다(getVariantOptionValues 가 빈 배열을 돌려주므로 실제
   * variant 쪽도 자연히 '' 로 떨어진다).
   *
   * fields 에 `variant:` 스코프 키가 하나도 없으면 조회 자체를 하지 않는다 — variant override
   * 가 없는 파일(v1 호환 경로)에서 조회 비용을 물지 않기 위해서다(product-import.manager.ts:198
   * 와 같은 이유·같은 패턴).
   */
  async resolveCreated(
    masterId: string,
    versionId: string,
    fields: FlatFields,
    plan: OptionPlan,
    tx: DbTransaction,
  ): Promise<Map<string, string>> {
    const comboKeys = new Set<string>();
    for (const path of Object.keys(fields)) {
      const parsed = parseFieldPath(path);
      if (parsed?.scope === 'variant') comboKeys.add(parsed.scopeKey);
    }
    if (comboKeys.size === 0) return new Map();

    const groups = await this.optionLoader.getOptionGroups(tx, masterId, versionId, LOCALE);
    const idByNamePair = new Map<string, string>();
    for (const group of groups) {
      for (const value of group.values) {
        idByNamePair.set(namePairKey(group.displayName, value.displayName), value.id);
      }
    }

    const mappings = await tx
      .select({ variantId: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

    const variantIdByIdKey = new Map<string, string>();
    for (const mapping of mappings) {
      const optionValues = await this.optionLoader.getVariantOptionValues(tx, mapping.variantId, versionId, LOCALE);
      const idKey = optionValues
        .map((ov) => ov.id)
        .sort()
        .join('+');
      variantIdByIdKey.set(idKey, mapping.variantId);
    }

    const result = new Map<string, string>();
    for (const combo of comboKeys) {
      const idKey = this.workbookComboToIdKey(combo, plan.valueNameByKey, idByNamePair);
      if (idKey === undefined) continue; // 구조가 깨진 조합 — checkCreateStructure 가 이미 걸렀어야 한다
      const variantId = variantIdByIdKey.get(idKey);
      if (variantId) result.set(combo, variantId);
    }
    return result;
  }

  /** 워크북 조합키(옵션값키들의 `+` 결합) → 실제 optionValueId 들의 정렬 조인. 풀 수 없으면 undefined. */
  private workbookComboToIdKey(
    combo: string,
    valueNameByKey: OptionPlan['valueNameByKey'],
    idByNamePair: ReadonlyMap<string, string>,
  ): string | undefined {
    if (combo === '') return '';
    const ids: string[] = [];
    for (const part of combo.split('+')) {
      const names = valueNameByKey.get(part);
      if (!names) return undefined;
      const id = idByNamePair.get(namePairKey(names.groupName, names.valueName));
      if (!id) return undefined;
      ids.push(id);
    }
    return ids.sort().join('+');
  }

  /**
   * (Task 7) 포크한 draft 에 실제로 매핑된 variant 들의 조합키(idKey) → variantId.
   *
   * `resolveCreated` 와 달리 이름→id 변환(`workbookComboToIdKey`)이 필요 없다 — 수정
   * 행의 `variant:<조합>.*` 스코프키는 워크북이 지은 이름이 아니라, 현재 active 를 내보낼
   * 때 이미 optionValueId 들을 정렬 조인해 채운 것이다(form-export.snapshot.reader.ts:268-271).
   * 즉 combo 자체가 이미 idKey 다.
   *
   * 옵션 없는 상품은 `getVariantOptionValues` 가 빈 배열을 돌려주므로 idKey 가 자연히 ''
   * 로 떨어진다 — F3 계약이 여기서도 그대로 유지된다.
   */
  async resolveExisting(masterId: string, versionId: string, tx: DbTransaction): Promise<Map<string, string>> {
    const mappings = await tx
      .select({ variantId: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

    const result = new Map<string, string>();
    for (const mapping of mappings) {
      const optionValues = await this.optionLoader.getVariantOptionValues(tx, mapping.variantId, versionId, LOCALE);
      const idKey = optionValues
        .map((ov) => ov.id)
        .sort()
        .join('+');
      result.set(idKey, mapping.variantId);
    }
    return result;
  }
}
