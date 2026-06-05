# 상품 상세설명은 Markdown 을 canonical 로 두고 legacy HTML 은 fallback 으로 유지한다

판매상품 master version 의 고객 노출 상세설명은 앞으로 Markdown 기반 `description` 을 canonical source 로 사용한다. 기존 live 상품 다수는 `description` 이 비어 있고 카페24/NNEditor 에서 이전된 raw HTML `descriptionHtml` 만 가지고 있으므로, `description` 이 없을 때만 `descriptionHtml` 을 legacy fallback 으로 렌더한다.

Markdown 안의 본문 이미지는 raw URL 이 아니라 file-service 의 `product-description-image` context 에 업로드된 File UUID 를 `::product-image{fileId="..." alt="..."}` directive 로 참조한다. 이 directive 와 Markdown 파싱 규칙은 NestJS/React 에 의존하지 않는 `packages/product-description` 공유 코드로 두고, React 렌더링 adapter 는 앱 내부 또는 별도 `packages/product-description-react` 로 분리한다. admin preview 와 storefront/customer renderer 는 같은 파싱 규칙을 공유하되 surface 별 표시 컴포넌트만 다르게 주입한다.

기존 HTML-only 상품을 관리자가 열면 Markdown 편집기는 비어 있게 두고 legacy HTML 은 read-only preview 로 보여준다. 자동 HTML→Markdown 변환이나 legacy HTML sanitizer 추가는 이번 전환 범위에 넣지 않는다. 새 draft version 을 만들 때는 부모 version 의 `description` 과 `descriptionHtml` 을 모두 복사하며, 판매채널에는 active version 의 상세설명만 projection 한다.

구현 라이브러리는 `react-markdown` + `remark-gfm` + `remark-directive` 계열로 고정한다. 임의 React 컴포넌트 실행이 필요한 MDX 나 더 강한 콘텐츠 스키마를 제공하는 Markdoc 까지는 현재 요구에 비해 무겁고, unified/remark 계열이 기본 Markdown AST 처리와 커스텀 directive 를 가장 작게 충족한다.

Medusa product 의 `description` 필드는 canonical 상세페이지 원천으로 쓰지 않는다. 현재는 null/empty projection 으로 두고, 고객용 상세 콘텐츠는 Core 의 active version 상세설명을 storefront 가 직접 가져와 동일한 Markdown 렌더 규칙과 legacy HTML fallback 규칙으로 렌더한다. 필요해지면 Medusa `description` 은 `description` Markdown 에서 plain text 를 추출하거나 AI 요약을 생성한 summary projection 으로만 쓴다.

## 고려한 대안

- `descriptionHtml` 을 계속 canonical 로 사용: 레거시 호환은 쉽지만 신규 작성 콘텐츠가 raw HTML 과 외부 이미지 URL 에 계속 묶인다.
- HTML 을 Markdown 으로 자동 변환: 전환 속도는 빠르지만 이미지 스택 HTML 과 인라인 style 중심의 기존 데이터를 손상시킬 위험이 크다.
- surface 별 렌더러를 따로 둠: 초기 구현은 단순하지만 관리자 미리보기와 고객 노출 결과가 달라질 수 있다.
- MDX/Markdoc 같은 더 강한 콘텐츠 시스템 사용: 확장성은 높지만 현재 요구는 Markdown 작성과 미리보기, file-service 이미지 참조에 가깝고 초기 복잡도가 커진다.

## 결과

- `description` 이 있으면 고객 노출 상세설명은 Markdown 렌더러가 우선한다.
- `description` 이 없으면 기존 `descriptionHtml` 을 호환 fallback 으로 유지한다.
- `description` 작성 정책상 raw HTML 을 쓰지 않는다. 단, 초기 구현에서 별도 저장 검증을 강제하지는 않고 렌더러가 HTML 을 특별 취급하지 않게 둔다.
- 상품 상세설명 이미지 참조가 깨졌을 때 storefront 는 placeholder 를 노출하고, admin preview 는 fileId 와 함께 불러오기 실패를 명확히 보여준다.
- Markdown renderer 는 `react-markdown` + `remark-gfm` + `remark-directive` 기반으로 구현한다.
- Medusa product `description` 은 상세 콘텐츠 원천이 아니며 현재는 null/empty 로 둔다. 필요해질 때만 summary projection 으로 도입한다.
