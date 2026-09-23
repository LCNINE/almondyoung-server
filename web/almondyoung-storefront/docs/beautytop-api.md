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

발급 제한은 프로세스당 회원별 분당 10회입니다. API 조회는 회원별 분당 60회, 전체 분당 600회입니다. `Retry-After`를 준수합니다. 이미 발급된 JWT는 로그아웃 후 최대 120초 유효할 수 있으므로 즉시 취소가 필요한 서비스에서는 별도 세션 폐기 확인 설계가 필요합니다.

권한 없음/변조/만료/다른 Origin, 조회 2페이지 중복 없음, 기존 로그인 회귀, 운영 프록시 HTTPS와 헤더, 로그아웃을 운영 환경에서 확인한 뒤 연결을 켭니다. 이 PR은 자동 배포·외부 공개·운영 키 등록을 수행하지 않습니다.

테스트: `yarn test src/lib/beautytop/member-token.test.ts src/lib/beautytop/client.test.ts`. 이 변경에 새 런타임 의존성은 없습니다.
