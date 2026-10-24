// OpenNext 설정. SST 의 buildCommand(@opennextjs/aws build)가 이 파일을 읽는다.
//
// 태그 캐시를 기본 `dynamodb` 대신 `dynamodb-nextMode` 로 둔다.
// 기본 모드는 (태그, 캐시 키) 쌍마다 한 행이다. 목록 fetch 의 캐시 키는 방문자별인데(cookies.ts
// getCacheTag), 모든 목록이 PRODUCT_LIST_TAG 를 함께 달아서 상품이 바뀔 때마다 /api/revalidate 의
// revalidateTag(PRODUCT_LIST_TAG) 한 번이 그 빌드의 방문자별 목록 키 수만큼 행을 다시 쓴다.
// 그래서 DynamoDB 가 계정 비용 1위였다(2026-10 23일 1.56억 WRU, $106).
// nextMode 는 태그당 한 행이고 revalidateTag 때만 쓴다. 대신 캐시를 읽을 때마다 그 항목의 태그를
// BatchGetItem 으로 한 번 조회한다(읽기 단가는 쓰기의 1/5).
//
// nextMode 는 revalidateTag 로 CloudFront 경로를 무효화하지 않는다. 지금은 페이지 HTML 이
// `private, no-store` 라 CDN 에 캐시되지 않으므로 잃는 것이 없다 — 페이지를 CDN 에 캐시하기
// 시작하면 이 전제부터 다시 볼 것.
//
// 설치된 OpenNext 버전을 바꾸면 deployments/lcnine/services/infra/services.ts 의 next15BuildCommand 와
// 함께 이 값이 그 버전에서도 유효한지 본다. import 없이 두는 것은 스토어프론트가 @opennextjs/aws 를
// 의존성으로 갖지 않기 때문이다(빌드는 npx 로 받는다).
const config = {
  default: {
    override: {
      tagCache: "dynamodb-nextMode",
    },
  },
  // 배포 때 태그를 미리 심는 시드 Lambda 도 같은 구현을 써야 한다. nextMode 면 시드는 아무것도 쓰지 않는다.
  initializationFunction: {
    tagCache: "dynamodb-nextMode",
  },
}

export default config
