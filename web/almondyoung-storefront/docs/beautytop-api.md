# 뷰티탑 회원 API 연결

현재 상태: 구현과 로컬 테스트 완료. 운영 서버 배포, 전용 RSA 키, 운영 API HTTPS 주소 설정 전에는 서비스에 연결되지 않습니다.

`POST /api/beautytop/token`은 기존 HttpOnly 로그인 쿠키를 읽고 user-service `/users/me`에 확인합니다. 인증된 회원만 RS256 서명의 120초짜리 `beautytop:read` JWT를 받습니다. 미설정은 503, 비회원은 401이며 도메인 허용만으로 접근 권한을 부여하지 않습니다. 기존 로그인 라우트와 키는 변경하지 않습니다.

서버 전용 환경변수:

- `BEAUTYTOP_SIGNING_PRIVATE_KEY`: 이 연동 전용 RSA 2048비트 이상 PEM. 기존 OIDC 키와 분리하며 NEXT_PUBLIC_ 변수를 사용하지 않습니다.
- `BEAUTYTOP_API_ORIGIN`: 외부 HTTPS 원점, 경로/쿼리 없이 설정. 로컬 관리 포트 8765는 공개하지 않습니다.

개인키는 아몬드영 비밀 저장소에 두고 공개키만 뷰티탑의 `config/almondyoung-beautytop-public.pem`에 저장합니다. 뷰티탑에서는 `scripts/partner_api.py`를 실행하며 HTTPS reverse proxy는 회원 API의 loopback 8767만 연결합니다. 프록시 access/error 로그에서 인증 헤더·쿠키를 제외하고, 토큰 발급 경로에도 요청 제한을 둡니다. 프로세스 내 rate limit은 여러 인스턴스의 전체 제한을 대신하지 않습니다.

```ts
import { queryBeautyTop } from "@/lib/beautytop/client"

const result = await queryBeautyTop<{ items: Array<{ id: number; name: string }> }>({
  resource: "shops", sido: "경기", gugun: "광주시", page: 1, page_size: 20,
})
// 페이지 수가 커지면 OFFSET 대신 다음 ID부터 이어 받기
if (result.pagination?.next_after_id != null) {
  await queryBeautyTop({
    resource: "shops", sido: "경기", gugun: "광주시",
    after_id: result.pagination.next_after_id, page_size: 20,
  })
}
// 상세에서 실제 가격·성장·운영 관측을 조회
await queryBeautyTop({ resource: "shop", id: 123 })
```

샵/검색/프랜차이즈 최대 50개, 순위/인원/가격/게시 활동 최대 30개. 기본 20개. `page`와 `after_id`를 함께 보내면 400입니다. 브라우저 헬퍼는 매 조회 때 로그인 상태를 다시 확인하며 동시에 진행되는 토큰 요청만 공유합니다. 토큰을 URL, localStorage, 쿠키에 저장하지 않습니다. 원래 아몬드영 로그인 토큰을 뷰티탑으로 전달하지 않습니다.

발급 제한은 프로세스당 회원별 분당 60회입니다(API 조회 한도와 같음). 한 화면의 동시 조회는 토큰 하나를 공유합니다. API 조회는 회원별 분당 60회, 전체 분당 600회입니다. `Retry-After`를 준수합니다. 이미 발급된 JWT는 로그아웃 후 최대 120초 유효할 수 있으므로 즉시 취소가 필요한 서비스에서는 별도 세션 폐기 확인 설계가 필요합니다.

권한 없음/변조/만료/다른 Origin, 조회 2페이지 중복 없음, 기존 로그인 회귀, 운영 프록시 HTTPS와 헤더, 로그아웃을 운영 환경에서 확인한 뒤 연결을 켭니다. 이 PR은 자동 배포·외부 공개·운영 키 등록을 수행하지 않습니다.

테스트: `yarn test src/lib/beautytop/member-token.test.ts src/lib/beautytop/client.test.ts`. 이 변경에 새 런타임 의존성은 없습니다.

## 전국 탐색과 성장 도구

전국 범위는 `sido`·`gugun`을 생략하고 `category`를 유지합니다. 시·도는 `sido`만, 동네는 둘 다 전송합니다. 공용 지역 통계는 기존 공개 캐시 경로를 사용합니다. 회원 발견 탭은 기존 멤버십·청약철회 확인을 통과한 뒤 지표별 순위를 조회하며, 내 샵과 비교는 사용자가 선택한 대상의 상세만 추가 조회합니다. 관측 대상에 개인 계정이 섞이고 전체 사업장을 포괄하지 않으므로 전국 매출 순위나 실력 순위로 해석하지 않습니다. 최하위 정렬 계약이 없어 전국 꼴등은 표시하지 않습니다.

가격 계산기는 사용자가 입력한 가격·월 방문 횟수로 매출 유지에 필요한 방문 수를 계산합니다. 원가·시간이 없으면 기여이익·시간당 수치는 표시하지 않습니다. 예시 값은 명시적으로 예시로 표시하고, 매출 예측이나 순이익으로 표현하지 않습니다.

성장 노트는 외부 뷰티탑 API가 아닌 user-service 소유 개인 기록입니다. 로그인 사용자 ID는 JWT에서만 받습니다.

- `GET /beautytop/growth-notes?shopKind=SHOP&shopId=...`: 사용자와 샵별 최신 30개 기록.
- `POST /beautytop/growth-notes`: `{ shopKind, shopId, action, memo? }`. 같은 트랜잭션에서 등록된 내 샵인지 확인합니다. `action`은 `MENU_CLARITY`, `SHOWCASE`, `PRICE_CHANGE`만 허용하며 메모는 240자 이내입니다.
- `DELETE /beautytop/growth-notes/:id?shopKind=SHOP&shopId=...`: 기록 ID·로그인 사용자·샵을 모두 확인합니다.

한국 날짜 기준 같은 사용자·샵·행동은 하루 한 번만 저장합니다. 중복 요청은 새 기록을 만들지 않습니다. 날짜는 저장 시점이며 실제 실행 또는 성과 인과관계를 검증하지 않습니다. 프론트 변경 요청은 Server Action과 `startTransition`을 사용합니다.

적용 순서: user-service migration `20261008010948_add-beautytop-growth-notes.sql` → user-service → storefront. Migration은 생성만 했으며 운영 DB에 적용하지 않았습니다. 새 환경변수와 외부 API 호출은 추가되지 않습니다.

다음 고도화에 필요한 외부 계약:

- 전국 최하위 비교: 지표별 오름차순 정렬, 샵/개인 분리 필터, 관측 대상 수·누락 기준·관측일. 현재 상위 페이지의 마지막 행을 전국 꼴등으로 사용하면 안 됩니다.
- 성장률 비교: 같은 대상·같은 기간의 시작/종료 값과 실제 관측 날짜. 누락·수집 중단을 0이나 하락으로 계산하지 않습니다.
- 성공 분석: 공개 리뷰·SNS·가격과 실제 매출·재방문·예약 전환을 구분합니다. 후자는 현재 제공되지 않으므로 공개 지표와 성공 사이 인과관계를 선언하지 않습니다.

제품의 반복 사용 흐름은 발견 → 내 샵과 비교 → 가격 검토 → 실행 기록 → 다음 방문에서 공개 지표 확인입니다. 실행 기록을 금액 성과로 환산하거나, 확인되지 않은 성공 비결로 표시하지 않습니다.

검증: 루트 타입 검사·단위 테스트, 뷰티탑 집중 테스트, 권한 감사, 일회용 로컬 DB의 마이그레이션·중복 방지·날짜·제약·삭제 연쇄를 확인했습니다. 합성 응답을 사용한 모바일·다국어 브라우저 검증에서 필터 전환, 비교, 계산, 기록 저장·삭제, 멤버십 흐름을 확인했습니다. 운영 인증 API와 배포 검증은 별도로 필요합니다.
