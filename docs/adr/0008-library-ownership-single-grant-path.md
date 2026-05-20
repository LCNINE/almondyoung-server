# Library ownership 의 grant 경로는 결제 단일 — 멤버십 베네핏은 pricing 으로 표현

라이브러리 ownership 의 grant 경로를 어디까지 인정할지가 모델 모양을 크게 가른다. Storefront i18n 잔재에 "멤버십만을 위한 다양한 무료 디지털 템플릿 무제한 다운로드" (`benefit07`) 같은 마케팅 카피가 있고, 멤버십 자격에 의한 자동 ownership 부여가 자연스러운 옵션처럼 보인다. 이 ADR 은 그 경로를 의도적으로 배제한다.

## Decision

- **`digitalAssetOwnerships` 의 grant 경로는 결제 (SO confirmed) 단일.** 멤버십 자격에 의한 자동 grant 경로는 두지 않는다.
- **멤버십 회원에게 디지털 상품을 무료/할인 제공하고 싶다면 pricing 모듈의 멤버십가** (0 원 포함) **로 표현**. 0 원 결제도 같은 `OrderConfirmed → SO confirmed → grantOwnershipsForOrder` 흐름을 그대로 탄다.
- **Storefront i18n 의 `benefit07` 카피 폐기** — 마케팅 약속이 아닌 채로 코드에 남아있던 잔재.

## Why this shape

검토한 대안과 채택 이유:

- **(A) Explicit grant — 멤버십 가입 시점에 베네핏 asset 들에 대해 ownership row 일괄 작성**: 베네핏 풀이 변경될 때마다 cascading 운영 (신규 asset → 기존 회원 모두에게 백필, 베네핏 풀에서 제외 → 회수). row 수도 `회원수 × 베네핏 asset 수` 로 비대해진다. exercise/revoke 라이프사이클이 멤버십 출처 row 에서는 의미가 다른데 같은 테이블에 섞임. 기각.
- **(B) Implicit entitlement — `membershipBenefitAssets` 정션만 두고 다운로드 시점에 권한 검사를 두 갈래(`ownership OR entitlement`)로**: 모델은 깔끔하지만 ownership 의 한 갈래가 "exercise 라는 개념이 없는 path" 로 갈라진다. 두 다른 의미의 권한이 storefront UX 에서 한 라이브러리 안에 섞임. 정책 변경 시 (멤버십 베네핏 풀 in/out) 사용자의 라이브러리가 사용자의 자율 선택 없이 자동으로 늘었다 줄었다 함.
- **(C, 채택) 결제 단일 경로 + pricing 으로 우회**: ownership 의 의미가 모델 전체에서 한 가지 ("내가 명시적으로 구매한 것"). exercise/revoke 라이프사이클이 의미 충돌 없이 모든 row 에 적용. 멤버십 베네핏의 비즈니스 의도는 pricing 모듈의 기존 추상에 자연 표현됨 (멤버십가 = 0 원). **부가 효과**: 사용자가 "이 콘텐츠를 받겠다" 는 명시적 행위 (장바구니 담기 → 0 원 결제) 가 자율적이라서 "원치 않는 콘텐츠가 라이브러리에 자동 누적" 문제가 자연 회피된다.

(B) 가 일견 매력적이었던 이유는 멤버십이라는 외부 자격이 권한을 자동 부여하는 모델이 SaaS 에선 표준이기 때문이다. 그러나 디지털 콘텐츠 e-commerce 의 멘탈 모델은 SaaS 의 entitlement 보다 **소유(ownership)** 에 가깝고 ("내 라이브러리"), 자율적 선택이 사용자 UX 의 핵심이다. (B) 의 자동 누적은 그 멘탈 모델과 어긋난다.

## Consequences

- `digitalAssetOwnerships` row 는 항상 `salesOrderId` 가 non-null. 출처가 단일 — 별도의 출처 컬럼/enum 불필요.
- 멤버십 베네핏으로 디지털 상품을 무료 제공하려면, pricing 모듈에 멤버십 등급별 `0` 가격 룰을 등록한다. 운영자 워크플로우: 디지털 상품(=variant)에 멤버십가 0 원 룰 추가 → 멤버십 회원이 그 상품을 장바구니에 담음 → 0 원 결제 → 라이브러리에 추가.
- Storefront `src/i18n/messages/ko/mypage.json` 의 `benefit07` 항목 삭제. 후속 i18n 동기화 (`ja`, `en`, …) 도 같이.
- 미래에 "멤버십 entitlement" 모델이 다시 검토될 때, 본 ADR 이 의도적 배제임을 보여준다. 재검토 트리거가 될 수 있는 신호: (가) 0 원 결제의 운영 오버헤드가 무시할 수 없을 만큼 큰 멤버십 베네핏 풀, (나) 멤버십 회원에게 베네핏 콘텐츠를 "구매 행위" 없이 자동으로 노출해야 하는 강한 UX 요구.
