# 버전 copy-on-write 통합 대신 표적 분해 (고아 정리만 추출)

판매상품 master 의 버전 격리는 정션 + copy-on-write(CoW)로 구현된다(CONTEXT.md, [[0004-variant-draft-scoped-edit-cow]]). 이 불변식이 variant·purchase constraint·pricing cascade·asset cascade 에 걸쳐 손으로 재구현되어 있다는 점을 들어, **이를 `(entity 테이블, version-junction 테이블, scope-reference hook)` 으로 파라미터화한 단일 "version CoW 모듈"로 통합하자**는 코드베이스 개선 제안이 있었다. 이 ADR 은 그 제안을 검토한 뒤 **통합 대신 표적 분해**를 택한 결정과 근거를 못 박는다.

## Decision

- **단일 파라미터화 CoW 모듈을 지금 만들지 않는다.** "한 규칙이 네 번 복사됐다"는 전제가 코드와 어긋난다. 네 곳은 같은 모양이 아니다:
  - **variant** — 정본 CoW(공유면 clone+repoint, 단독이면 in-place). `product-variants.service.ts:390-418`.
  - **purchase constraint** — 같은 CoW 모양을 독립 재구현. `product-purchase-constraints.service.ts:120-160`.
  - **pricing rule** — CoW 가 아니라 version 단위 **whole-set 교체**(`replaceVersionRules`). per-rule clone 은 variant CoW 의 cascade 에서만 발생(참조 정합용 기계적 repoint). 의도된 결정 — CONTEXT.md "가격 규칙은 per-row CoW 대상이 아니다" 참조.
  - **asset link** — 독립 CoW 가 아니라 **cascade 전용**. `cloneLinksForVariant`(편집 시) / `inheritLinksFromTwins`(publish 시)로 서비스 위임.
- **CoW 분기(공유? clone+repoint : in-place)는 concern 별로 둔다.** 진짜 이 모양인 건 variant·purchase constraint 둘뿐이고, 공유되는 골격은 4줄짜리 if/else 인데 본문(곁테이블 clone, cascade 대상, 고아 정리)은 전부 다르다. 통합하면 대부분이 hook 인 과추상화가 된다.
- **단 하나, 진짜로 동일한 프리미티브 — 고아 정리 — 만 추출한다.** "이 entity 를 가리키는 정션이 0개면 entity 삭제"가 **4개 파일에 8벌** 존재한다(variant 3, pricing rule 2, purchase constraint 3; 그중 `product-masters.service.ts:1046-1058` 은 메서드 추출조차 안 된 인라인). 이를 순수 함수 하나로 통일한다:

  ```ts
  // apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts
  deleteEntitiesIfUnmapped(
    tx,
    { entityTable, entityIdColumn, junctionTable, junctionFkColumn },
    ids: string[],
  ): Promise<number> // 삭제 수
  ```

  카운트는 fk 단일 기준으로 통일하고 `masterId` 추가 필터는 버린다(variant 카운트가 `:1393` 은 `(masterId, variantId)`, `:1052` 는 `variantId` 만 — variantId 가 전역 unique 라 동치이나, 통일로 이 drift 를 없앤다).
- **위험하고 미테스트인 경로에 characterization test 를 붙인다.** variant CoW(`:390-418`)와 변경된 variantId 를 pricing rule 로 전파하는 cascade(`:503-578`, **현재 테스트 없음**)에 shared→clone / single→in-place / cascade-repoint 시나리오를 잠근다. masterId 필터 제거의 동치성(fk-only 카운트 == (masterId,fk) 카운트)도 테스트로 명시 고정한다.

## Why this shape

검토한 대안과 채택 이유:

- **(a) 제안 그대로 — 단일 파라미터화 CoW 모듈**: 기각(지금은). concern 4개 중 2개만 CoW 모양이고 pricing=whole-set, asset=cascade-only 다. 공유 골격이 너무 얇고 본문이 전부 갈라져, 제안이 약속한 "leverage(다음 concern 은 등록만)"는 **세 번째 진짜 CoW concern 이 생기기 전엔 본전을 못 뽑는다**. 제안이 든 유일한 구체 증거(테스트 없는 cascade)는 추상화 없이 테스트로 직접 해소 가능.
- **(b) variant + purchase constraint 의 CoW 만 얇은 헬퍼로 통합**: 보류. 본문이 너무 다르다 — variant 는 `variantOptionValues` 곁테이블 + pricing/asset 두 cascade, constraint 는 version 당 최대 1개 + cascade 없음. 공유는 if/else 골격뿐이라 이득이 작다.
- **(c, 채택) 표적 분해**: 진짜 동일한 프리미티브(고아 정리)만 추출, 위험한 cascade 엔 테스트, CoW 분기와 cross-BC cascade 는 concern 별로 둔다. 리스크 대비 이득이 가장 명확(고아 정리는 동작 변경 0)하고, 미래의 통합 여지를 닫지 않는다.

## Consequences

- 고아 정리 8벌 → 순수 함수 1개. variant 카운트의 masterId 필터 불일치 제거. 호출부는 `product-versions`·`product-masters`·`pricing`·`product-purchase-constraints` 네 서비스.
- variant→pricing cascade(`:503-578`)가 처음으로 테스트를 갖는다.
- CoW 분기 로직은 variant·purchase constraint 두 곳에 그대로 중복으로 남는다 — 의도된 수용(개수 적고 본문 상이).
- cross-BC cascade 의 비대칭(variant→asset 은 서비스 위임, variant→pricing 은 직접 테이블 접근)은 이번에 통일하지 않는다. 알려진 불일치로 남기며, 모듈 경계 판단은 [[0004-variant-draft-scoped-edit-cow]] 의 근거를 계속 따른다.
- **재검토 트리거**: (1) 진짜 per-row CoW 가 필요한 **세 번째** version-owned concern 이 생기거나, (2) variant·constraint 의 CoW 본문이 수렴하면, 그때 (b)→(a) 순으로 통합을 다시 검토한다. `catalog/core/version-isolation/` 가 그 착지점이다.
