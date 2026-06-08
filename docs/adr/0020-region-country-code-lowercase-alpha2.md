# 리전/국가 식별자는 소문자 ISO 3166-1 alpha-2 로 통일한다

플랫폼이 다국가(리전) 운영으로 확장되면서 "국가/리전"을 식별하는 키가 여러 곳에서 필요해졌다. wallet 의 리전별 결제수단 관리, storefront 의 `[countryCode]` 동적 라우트, Medusa 의 region/country, 알림(Twilio) 의 전화번호 국가 등이 각자 다른 표기(소문자/대문자, region UUID/country code)를 쓰면 경계마다 변환 버그와 매칭 실패가 생긴다.

기존 현황: Medusa 는 `region.countries.iso_2` 와 cart `country_code` 에 **소문자 alpha-2**(`kr`)를 쓰고, storefront `[countryCode]` 라우트도 소문자다. user-service 의 Twilio lookup 만 대문자(`KR`)를 요구한다. wallet 에는 리전 개념이 없었다.

## 결정

- 리전/국가를 식별하는 키는 **소문자 ISO 3166-1 alpha-2 국가코드**(`kr`, `us`)로 통일한다. 이것이 플랫폼 전역의 canonical 표기다.
- wallet 의 `regions.code` 는 `varchar(2)` 이며 `code = lower(code)` CHECK 제약으로 소문자를 강제한다. 입력 DTO 도 진입 시 `toLowerCase()` 정규화 후 `^[a-z]{2}$` 로 검증한다.
- storefront → wallet-web → wallet 으로 리전을 전달할 때 이 키(`?region=kr`)를 그대로 쓴다. Medusa `region.countries.iso_2` 와 동일 값이므로 별도 매핑 테이블이 필요 없다.
- 대문자 alpha-2(예: ISO 표준 표기) 또는 alpha-3 를 요구하는 외부 연동(Twilio 등)은 **경계에서만** 변환한다(`code.toUpperCase()`). 내부 저장/전달 값은 항상 소문자로 유지한다.
- 새로 국가 식별이 필요한 코드(스토어프론트 라우트, 결제, 배송, 정산 등)는 이 표준을 따른다. region UUID(Medusa 내부 식별자)를 도메인 간 경계로 넘기지 않는다.

## Consequences

- wallet 리전 키와 Medusa/스토어프론트 country code 가 변환 없이 정합한다.
- Twilio 처럼 대문자를 요구하는 연동은 명시적 변환 한 줄로 처리되며, 그 외 코드는 표기 분기를 갖지 않는다.
- 향후 country code 가 필요한 이벤트/페이로드(예: 주문 이벤트)에도 소문자 alpha-2 를 싣는 것을 기본으로 한다.
- 외부 시스템이 대문자/alpha-3 만 제공하는 경우, 수신 어댑터가 소문자 alpha-2 로 정규화한 뒤 내부로 전달할 책임을 진다.
