import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, eq } from 'drizzle-orm';
import { type PimSchema, productMasterVariants, productMasterVersions } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { ProductVariantsService } from '../../../core/products/services/product-variants.service';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductPurchaseConstraintsService } from '../../../core/products/services/product-purchase-constraints.service';
import { UpdateProductVariantDto } from '../../../core/products/dto';
import { UpsertPurchaseConstraintDto } from '../../../core/products/dto/purchase-constraints';
import { type ModifyOptionDisplayDto } from '../../../catalog.types';
import { buildVersionData, type ImageResolver } from './bulk-draft.fields';
import { buildOptionAdd, buildOptionModify, checkCreateStructure, type OptionPlan } from './bulk-draft.options';
import { applyPriceChanges, toReplaceDto } from './bulk-draft.pricing';
import { extractSimplePrices } from './form-export.pricing-judge';
import { applyDecisions } from './bulk-session.diff';
import { parseFieldPath } from './bulk-session.fields';
import {
  formatRowErrors,
  type BulkBaseSnapshot,
  type BulkItemPayload,
  type ConflictDecisionMap,
  type FlatFields,
  type PrefillRow,
} from './bulk-session.types';

/** 옵션 그룹·값 표시명을 읽을 로케일. form-export.snapshot.reader.ts 와 같은 값 — 워크북이 이 로케일로만 채워진다. */
const LOCALE = 'ko-KR';

/** (그룹명, 값명) 쌍의 맵 키. NUL 구분자를 쓰는 이유는 표시명 자체에 공백이 흔해서다 —
 *  단순 공백 결합이면 그룹 "A B" 값 "C" 와 그룹 "A" 값 "B C" 가 같은 키로 충돌한다. */
function namePairKey(groupName: string, valueName: string): string {
  return [groupName, valueName].join('\u0000');
}

export interface DraftInput {
  sessionId: string;
  userId: string;
  kind: 'create' | 'update';
  masterId: string | null;
  payload: BulkItemPayload;
  /**
   * 업로드 원본의 옵션 시트 행(`BulkItemInput['bundle']['options']`). 신규 행의 옵션 **그룹 귀속**은
   * `payload.fields` 에서 복원할 수 없다 — 평면화가 그 정보를 잃는다(Task 4 리뷰, 2026-08-03).
   * 한 행이 optionKey·optionValueKey 를 함께 들고 있는 이 배열이 유일한 권위 있는 출처다.
   */
  optionRows: PrefillRow[];
  /**
   * 업로드 원본의 조합 시트 행(`BulkItemInput['bundle']['variants']`). `checkCreateStructure`
   * 가 "같은 조합 두 번" 을 검사하는 유일한 출처다 — `payload.fields` 는 평면화 과정에서
   * 뒤 행이 앞 행을 덮어써 몇 번 나왔는지 정보가 이미 사라진다(Task 10, 부록 C.4).
   */
  variantRows: PrefillRow[];
  conflictDecision: ConflictDecisionMap;
  baseSnapshot: BulkBaseSnapshot | null;
  images: ImageResolver;
}

/**
 * 엑셀 한 행을 실제 master + draft 버전으로 조립하는 Manager. Task 3·4·5 의 순수 변환기
 * (bulk-draft.fields/options/pricing)를 조립하고, catalog core 서비스(ProductMastersService 등)
 * 를 호출해 실제로 쓴다.
 *
 * **트랜잭션은 호출부가 연다** — `apply(input, tx)` 는 새 트랜잭션을 열지 않고 받은 `tx` 를
 * 그대로 core 서비스들에 전파한다(ADR-0025). 잠금 UPDATE(`lockDraft`)가 이 클래스가 직접
 * 쓰는 유일한 무조건 실행 DB 문장이고, `resolveCreatedCombos` 의 조회는 조합 해석이 실제로
 * 필요할 때만(= fields 에 `variant:` 스코프 키가 있을 때만) 탄다.
 */
@Injectable()
export class BulkDraftApplier {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly masters: ProductMastersService,
    private readonly versions: ProductVersionsService,
    private readonly variants: ProductVariantsService,
    private readonly optionLoader: OptionReadLoader,
    private readonly pricing: PricingService,
    private readonly constraints: ProductPurchaseConstraintsService,
  ) {}

  /** 성공하면 draft 버전 id 와 (신규면) 새 masterId 를 돌려준다. 행 오류는 BadRequestError 로 던진다. */
  async apply(input: DraftInput, tx: DbTransaction): Promise<{ draftVersionId: string; masterId: string }> {
    if (input.kind === 'update') {
      return this.applyUpdate(input, tx);
    }
    return this.applyCreate(input, tx);
  }

  /**
   * 수정 행: 스냅샷이 아니라 **현재 active 에서 포크**한 뒤 변경분만 얹는다. 그 사이 남이
   * 발행한 변경을 살리기 위해서다(publishVersion 은 병합이 아니라 통째 교체 — 스펙 §2.2,
   * §3.6). `createDraftVersion(..., copyMappings=true)` 가 옵션 표시·variant 정션·가격룰
   * 정션·구매제약을 전부 복사해 두므로, 여기서는 바뀐 필드만 덮으면 된다.
   */
  private async applyUpdate(
    input: DraftInput,
    tx: DbTransaction,
  ): Promise<{ draftVersionId: string; masterId: string }> {
    const masterId = input.masterId;
    if (!masterId || !input.baseSnapshot) {
      throw new BadRequestError('기준 상품 정보가 없어 수정할 수 없습니다. 양식을 다시 받아 주세요.');
    }

    // ① 충돌 결정이 'skip' 인 필드를 적용분에서 뺀다. 결정은 **필드 단위**다(스펙 §3.6) —
    //    행 단위로 뭉치면 무관한 필드까지 함께 되돌아간다. `applyDecisions`(bulk-session.diff.ts)
    //    는 이미 같은 의미론을 갖고 있고 자체 스펙이 덮는다 — 여기서 복제하지 않는다.
    const fields = applyDecisions(input.payload.fields, input.conflictDecision);

    // ② 현재 active 에서 포크한다. 스냅샷에서 포크하면 그 사이 남이 발행한 변경이 이 draft 가
    //    발행되는 순간 통째로 사라진다.
    const active = await this.versions.getActiveVersion(masterId, tx);
    const draft = await this.versions.createDraftVersion(active.id, input.userId, true, tx);

    // ③ 스칼라·이미지·카테고리 + 옵션 표시 변경. 수정 행은 옵션 구조를 못 바꾸므로
    //    optionRows 가 아니라 buildOptionModify(순수 함수, fields 만 본다)를 쓴다.
    const { data, errors } = buildVersionData(fields, { ...input.payload, fields }, input.images);
    const { modify, errors: optionErrors } = buildOptionModify(fields);
    const all = [...errors, ...optionErrors];
    if (all.length > 0) throw new BadRequestError(formatRowErrors(all));

    const resolvedModify = await this.attachGroupIds(masterId, draft.id, modify, tx);
    await this.masters.updateVersion(
      draft.id,
      { ...data, ...(resolvedModify.length > 0 ? { optionDiff: { modifyDisplay: resolvedModify } } : {}) },
      tx,
    );

    // ④ variant. 포크한 draft 는 active 와 variantId 를 공유하므로 반드시 CoW 경로다(F6) —
    //    bulkUpdateVariantsInDraft 가 그 경로를 돈다. fields 에 variant 스코프 키가 없으면
    //    조회 자체를 안 한다(resolveCreatedCombos 와 같은 이유·같은 패턴).
    const touchesVariant = Object.keys(fields).some((path) => parseFieldPath(path)?.scope === 'variant');
    const variantIdByCombo = touchesVariant
      ? await this.resolveExistingCombos(masterId, draft.id, tx)
      : new Map<string, string>();
    const cowMap = await this.applyVariantCodes(masterId, draft.id, fields, variantIdByCombo, tx);

    // ⑤ 가격. 두 경우에 **아예 손대지 않는다**:
    //   (a) 얼린 판정이 false — replace 를 부르는 순간 복합 룰이 단순 override 로 뭉개진다(F9)
    //   (b) 이 행이 가격 칸을 하나도 안 건드렸다 — `_copyMappings` 가 복사한 룰이 이미 정답이다.
    //       부르면 같은 룰을 지웠다 다시 만드는 왕복일 뿐이고, 더 나쁘게는 all_variants 판매가
    //       룰이 없는 상품에서 `toReplaceDto` 가 throw 해 가격과 무관한 수정(브랜드만 바꾼 행)이
    //       실패한다(Task 5 리뷰 — toReplaceDto 는 basePrice 가 null 이면 항상 throw 한다).
    const touchesPrice = Object.keys(fields).some(
      (path) =>
        path === 'product.basePrice' ||
        path === 'product.membershipPrice' ||
        /^variant:.*\.(basePrice|membershipPrice)$/.test(path),
    );
    if (input.baseSnapshot.pricingEditable !== false && touchesPrice) {
      // 포크한 draft 의 룰을 읽는다(active 가 아니라) — _copyMappings 가 이미 복사했으므로
      // 값은 같지만, replace 대상과 "지금 이 draft 에 실제로 달린 것"을 일치시킨다.
      const current = extractSimplePrices(await this.pricing.getVersionRules(draft.id, tx));
      const { prices, errors: priceErrors } = applyPriceChanges(current, fields, cowMap);
      if (priceErrors.length > 0) throw new BadRequestError(formatRowErrors(priceErrors));
      await this.pricing.replaceVersionRules(draft.id, toReplaceDto(prices), tx);
    }

    await this.applyConstraintUpdate(masterId, draft.id, fields, tx);
    await this.lockDraft(draft.id, input.sessionId, tx);
    return { draftVersionId: draft.id, masterId };
  }

  private async applyCreate(
    input: DraftInput,
    tx: DbTransaction,
  ): Promise<{ draftVersionId: string; masterId: string }> {
    const fields = input.payload.fields;

    // ① 구조 검증이 먼저다 — master 를 만든 뒤 실패하면 롤백이 지워주긴 하지만, 검증이
    //    가능한 것을 쓰기 뒤로 미루면 실패 비용만 커진다.
    const structureErrors = checkCreateStructure(fields, input.optionRows, input.variantRows);
    if (structureErrors.length > 0) throw new BadRequestError(formatRowErrors(structureErrors));

    const { data, errors } = buildVersionData(fields, input.payload, input.images);
    const { plan, errors: optionErrors } = buildOptionAdd(fields, input.optionRows);
    const all = [...errors, ...optionErrors];
    if (all.length > 0) throw new BadRequestError(formatRowErrors(all));

    // ② master + draft 버전
    const version = await this.masters.createMaster(input.userId, tx);

    // ③ 스칼라·이미지·카테고리 + 옵션 추가. optionDiff.add 가 있으면 updateVersion 이
    //    variant 를 자동 생성한다(_regenerateVariantsForVersion).
    await this.masters.updateVersion(
      version.id,
      { ...data, ...(plan.add.length > 0 ? { optionDiff: { add: plan.add } } : {}) },
      tx,
    );

    // ④ 조합 → variantId. 신규 행은 워크북 키가 작업자가 지은 이름이라 되읽어 짝지어야 한다(F7).
    const variantIdByCombo = await this.resolveCreatedCombos(version.masterId, version.id, fields, plan, tx);

    // ⑤ variantCode. 갓 만든 master 라 CoW 가 필요 없지만 **경로를 하나로 유지한다** —
    //    CoW 판정은 "다른 버전에도 매핑됐는가"이므로 단독 매핑인 여기서는 in-place UPDATE 로
    //    떨어진다(product-variants.service.ts:401 앞의 분기). 두 경로를 나누면 나중에 한쪽만 고쳐진다.
    await this.applyVariantCodes(version.masterId, version.id, fields, variantIdByCombo, tx);

    // ⑥ 가격. 신규는 현재 룰이 없으므로 빈 SimplePrices 에서 시작한다.
    const { prices, errors: priceErrors } = applyPriceChanges(
      { basePrice: null, membershipPrice: null, variantOverrides: new Map() },
      fields,
      variantIdByCombo,
    );
    if (priceErrors.length > 0) throw new BadRequestError(formatRowErrors(priceErrors));
    await this.pricing.replaceVersionRules(version.id, toReplaceDto(prices), tx);

    // ⑦ 구매제약. 값이 없으면 부르지 않는다 — upsertForDraft 의 isDeleteIntent 가
    //    "requiresMembership=false + limit=null" 을 삭제로 읽으므로 신규엔 왕복만 는다
    //    (v3 product-import.manager.ts:190-197 과 같은 근거).
    await this.applyConstraint(version.masterId, version.id, fields, tx);

    await this.lockDraft(version.id, input.sessionId, tx);
    return { draftVersionId: version.id, masterId: version.masterId };
  }

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
  private async resolveCreatedCombos(
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
   * variant 별 품목코드. 빈칸은 손대지 않는다(v3 와 같은 규약 — 지우고 싶으면 별도 기능이 필요).
   *
   * **CoW 로 바뀐 variantId 를 반영한 맵을 돌려준다**(Task 7) — variantCode 를 바꾼 조합은
   * `bulkUpdateVariantsInDraft` 가 돌려준 새 variantId 로, 안 바꾼 조합은 원래 id 그대로
   * 담는다. 수정 경로의 가격 적용이 이 맵을 써야 CoW 로 새로 생긴 variantId 에 가격 룰을
   * 건다(F6 — 포크한 draft 는 active 와 variantId 를 공유하므로 편집은 반드시 CoW 경로).
   * 신규 경로는 CoW 가 없어(단독 매핑) 이 맵이 입력과 항등이다 — 그 호출부는 반환값을
   * 쓰지 않는다.
   */
  private async applyVariantCodes(
    masterId: string,
    versionId: string,
    fields: FlatFields,
    variantIdByCombo: ReadonlyMap<string, string>,
    tx: DbTransaction,
  ): Promise<Map<string, string>> {
    const updates: Array<{ id: string } & UpdateProductVariantDto> = [];
    for (const path of Object.keys(fields)) {
      const parsed = parseFieldPath(path);
      if (!parsed || parsed.scope !== 'variant' || parsed.key !== 'variantCode') continue;
      const code = (fields[path] ?? '').trim();
      if (code === '') continue;
      const variantId = variantIdByCombo.get(parsed.scopeKey);
      if (!variantId) {
        // `applyPriceChanges`(bulk-draft.pricing.ts:65-69)가 **똑같은 조건**에 대해 내는 오류와
        // 형태를 맞춘다 — 거긴 `formatRowErrors` 를 타 `[조합]` 접두가 붙는데 여기만 맨 문장을
        // 던지면, 같은 원인의 행 오류가 시트 표시 유무로 갈려 관리자 화면에서 다른 문제처럼 보인다.
        throw new BadRequestError(
          formatRowErrors([
            { sheet: '조합', rowNumber: 0, message: `조합에 해당하는 variant 를 찾을 수 없습니다: ${parsed.scopeKey}` },
          ]),
        );
      }
      updates.push({ id: variantId, variantCode: code });
    }
    if (updates.length === 0) return new Map(variantIdByCombo);

    const results = await this.variants.bulkUpdateVariantsInDraft(masterId, versionId, updates, tx);
    const newIdByOriginal = new Map(results.map((r) => [r.originalId, r.variantId]));
    const cowMap = new Map<string, string>();
    for (const [combo, variantId] of variantIdByCombo) {
      cowMap.set(combo, newIdByOriginal.get(variantId) ?? variantId);
    }
    return cowMap;
  }

  /**
   * (Task 7) 포크한 draft 에 실제로 매핑된 variant 들의 조합키(idKey) → variantId.
   *
   * `resolveCreatedCombos` 와 달리 이름→id 변환(`workbookComboToIdKey`)이 필요 없다 — 수정
   * 행의 `variant:<조합>.*` 스코프키는 워크북이 지은 이름이 아니라, 현재 active 를 내보낼
   * 때 이미 optionValueId 들을 정렬 조인해 채운 것이다(form-export.snapshot.reader.ts:268-271).
   * 즉 combo 자체가 이미 idKey 다.
   *
   * 옵션 없는 상품은 `getVariantOptionValues` 가 빈 배열을 돌려주므로 idKey 가 자연히 ''
   * 로 떨어진다 — F3 계약이 여기서도 그대로 유지된다.
   */
  private async resolveExistingCombos(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<Map<string, string>> {
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

  /**
   * (Task 7) `buildOptionModify` 가 값 스코프 항목에 남긴 `optionGroupId: ''` 를 실제 소속
   * 그룹으로 채운다 — 필드경로만으로는 그룹 귀속을 알 수 없어서다(buildOptionModify 의
   * 문서 주석). `getOptionGroups` 로 optionValueId → optionGroupId 맵을 만들어 쓴다.
   *
   * 수정 행은 옵션값 **추가**가 금지된다(스펙 §3.7) — 그래서 못 찾은 optionValueId 는
   * "이 값이 새로 생겼다"가 아니라 데이터가 어긋났다는 뜻이고, 조용히 넘기면 엉뚱한
   * 그룹으로 매핑될 위험이 있어 행 오류로 던진다.
   */
  private async attachGroupIds(
    masterId: string,
    versionId: string,
    modify: ModifyOptionDisplayDto[],
    tx: DbTransaction,
  ): Promise<ModifyOptionDisplayDto[]> {
    const needsGroupId = modify.some((entry) => entry.optionGroupId === '');
    if (!needsGroupId) return modify;

    const groups = await this.optionLoader.getOptionGroups(tx, masterId, versionId, LOCALE);
    const groupIdByValueId = new Map<string, string>();
    for (const group of groups) {
      for (const value of group.values) {
        groupIdByValueId.set(value.id, group.id);
      }
    }

    return modify.map((entry) => {
      if (entry.optionGroupId !== '') return entry;
      const valueId = entry.values?.[0]?.optionValueId;
      const groupId = valueId ? groupIdByValueId.get(valueId) : undefined;
      if (!groupId) {
        throw new BadRequestError(`옵션값을 찾을 수 없습니다: ${valueId ?? '(알 수 없음)'}`);
      }
      return { ...entry, optionGroupId: groupId };
    });
  }

  /**
   * 구매제약(신규 경로 전용). `constraint.requiresMembership`/`constraint.lifetimeQuantityLimit`
   * 둘 다 fields 에 없으면(=업로드에 구매제약 행이 없었으면) 부르지 않는다 — upsertForDraft 의
   * isDeleteIntent 가 "requiresMembership=false + limit=null" 을 삭제로 해석하므로, 신규
   * 생성에서 지울 것도 없이 부르면 왕복만 늘어난다.
   *
   * **신규 행은 `fields` 가 입력 전체라 두 축을 항상 같이 읽어도 안전하다.** 수정 행은
   * `fields` 가 변경분만 담아 이 가정이 깨진다 — `applyConstraintUpdate` 를 따로 둔 이유다.
   */
  private async applyConstraint(
    masterId: string,
    versionId: string,
    fields: FlatFields,
    tx: DbTransaction,
  ): Promise<void> {
    const touched = (key: string): boolean => `constraint.${key}` in fields;
    if (!touched('requiresMembership') && !touched('lifetimeQuantityLimit')) return;

    const requiresMembership = (fields['constraint.requiresMembership'] ?? '').trim() === 'Y';
    const limitRaw = (fields['constraint.lifetimeQuantityLimit'] ?? '').trim();
    const dto: UpsertPurchaseConstraintDto = {
      requiresMembership,
      lifetimeQuantityLimit: limitRaw === '' ? null : Number(limitRaw),
    };
    await this.constraints.upsertForDraft(masterId, versionId, dto, tx);
  }

  /**
   * 구매제약(수정 경로 전용, fix round 1). 수정 행의 `fields` 는 **변경분만** 담는다
   * (`computeChanges`) — 그래서 `applyConstraint` 처럼 두 축을 한 덩어리로 읽어 없는 축을
   * "없음"으로 해석하면, 한도만 고친 행이 멤버십필요를 조용히 해제하거나(시나리오 A),
   * 멤버십필요만 고친 행이 `isDeleteIntent` 에 걸려 한도까지 통째로 삭제된다(시나리오 B).
   * 둘 다 발행 후에야 발견되는 사고라 리뷰에서 Critical 로 잡혔다.
   *
   * 두 축 중 **하나라도** fields 에 있을 때만 손대고, **없는 축은 포크한 draft 의 현재 값**
   * (`getForVersion`)으로 채운 뒤 upsert 한다 — 스냅샷이 아니라 draft 에서 읽는 것은 포크를
   * active 에서 뜬 것과 같은 이유다(§3.6 병합 설계 일관성). 둘 다 없으면 지금처럼 아예
   * 부르지 않는다.
   */
  private async applyConstraintUpdate(
    masterId: string,
    versionId: string,
    fields: FlatFields,
    tx: DbTransaction,
  ): Promise<void> {
    const touchedMembership = 'constraint.requiresMembership' in fields;
    const touchedLimit = 'constraint.lifetimeQuantityLimit' in fields;
    if (!touchedMembership && !touchedLimit) return;

    const current = await this.constraints.getForVersion(masterId, versionId, tx);

    const requiresMembership = touchedMembership
      ? (fields['constraint.requiresMembership'] ?? '').trim() === 'Y'
      : (current?.requiresMembership ?? false);

    const limitRaw = (fields['constraint.lifetimeQuantityLimit'] ?? '').trim();
    const lifetimeQuantityLimit = touchedLimit
      ? limitRaw === ''
        ? null
        : Number(limitRaw)
      : (current?.lifetimeQuantityLimit ?? null);

    const dto: UpsertPurchaseConstraintDto = { requiresMembership, lifetimeQuantityLimit };
    await this.constraints.upsertForDraft(masterId, versionId, dto, tx);
  }

  private async lockDraft(versionId: string, sessionId: string, tx: DbTransaction): Promise<void> {
    await tx
      .update(productMasterVersions)
      .set({ bulkSessionId: sessionId, updatedAt: new Date() })
      .where(eq(productMasterVersions.id, versionId));
  }
}
