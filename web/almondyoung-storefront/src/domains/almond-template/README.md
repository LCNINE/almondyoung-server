# 아몬드템플릿

인쇄물(배너·명함·메뉴판 등) 시안을 고르고 편집하는 스토어프론트 기능이다. 시안 원본은 ugc-service 의 `almond_templates` 테이블에 있다.

## 흐름

- **디자이너**: `/{countryCode}/almond-template?mode=designer` 에서 상품·크기·시안 이름을 정해 디자인하고 `임시 저장` 을 누르면 서버에 초안(`draft`)으로 저장된다. `불러오기` 목록에서 초안을 열거나, `게시하기`/`내리기` 로 공개 여부를 바꾸거나, 지운다. 같은 상품·크기·이름으로 다시 저장하면 그 시안을 덮어쓰고 게시 상태는 그대로 둔다(게시 중이면 고객 화면에 바로 반영).
- **고객**: `/{countryCode}/almond-template` 목록에서 상품 유형·크기·색상·검색어로 게시된 시안을 찾고, 카드를 누르면 `/{countryCode}/almond-template/edit` 편집기로 들어간다. 한 페이지에 18개. 옵션·수량·부자재·가격은 기존 상품 상세페이지의 Medusa variant 에서 고른다.

## 권한

디자이너 모드와 관리자 API 는 `admin:template:write` 스코프가 필요하다. 스코프는 `apps/ugc-service/src/shared/auth/ugc-scopes.ts` 에서 `admin` 역할에 매핑돼 있고, 스코프가 없는 사람이 `mode=designer` 로 들어오면 404 다. 공개 목록·상세·썸네일은 인증 없이 읽는다.

## API (ugc-service)

| 메서드 | 경로                                                                                  | 권한                   |
| ------ | ------------------------------------------------------------------------------------- | ---------------------- |
| GET    | `/almond-templates` · `/almond-templates/:id` · `/almond-templates/:id/thumbnail.svg` | 공개 (published 만)    |
| GET    | `/admin/almond-templates` · `/admin/almond-templates/:id`                             | `admin:template:write` |
| PUT    | `/admin/almond-templates` (업서트)                                                    | `admin:template:write` |
| PATCH  | `/admin/almond-templates/:id/status`                                                  | `admin:template:write` |
| DELETE | `/admin/almond-templates/:id`                                                         | `admin:template:write` |

스토어프론트 호출부는 `src/lib/api/ugc/almond-templates.ts`. 저장 전에 `lib/document.ts` 의 `parseDesign` 으로 고객 편집기가 여는 것과 같은 형식 검사를 한다.

## 폴더

- `components/` 편집기(`editor/`), 목록(`gallery.tsx`), 색상 선택기, 레이어 렌더링
- `hooks/` 편집기 상태. 서버 저장·불러오기는 `use-template-storage.ts`
- `lib/` 문서 모델·검증(`document.ts`), 인쇄 상품 카탈로그(`catalog.ts`), 목록 필터
- `assets/` 클립아트·프레임 원본

## 한계

- 서버액션 본문 상한(`next.config.js` 의 `serverActions.bodySizeLimit`)이 12MB 라, 큰 이미지를 넣은 시안은 저장이 거절될 수 있다.
- SVG·JSON 은 인쇄 접수용 AI/EPS 가 아니다. 실제 발주 연결에는 와우프레스 파일 검수 통과와 주문별 디자인 파일 보관·결제 완료 이벤트 연동이 필요하다.
