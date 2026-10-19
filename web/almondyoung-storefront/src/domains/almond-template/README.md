# 아몬드템플릿

인쇄물(배너·명함·메뉴판 등) 시안을 고르고 편집하는 스토어프론트 기능이다. 시안 원본은 ugc-service 의 `almond_templates` 테이블에 있다.

## 흐름

- **디자이너**: `/{countryCode}/almond-template?mode=designer` 에서 상품·크기·시안 이름을 정해 디자인하고 `저장` 을 누르면 서버에 초안(`draft`)으로 저장된다. 불러온 시안은 id 로 그 시안을 갱신하고 게시 상태는 그대로 둔다(게시 중이면 고객 화면에 바로 반영). 상품·크기·이름이 불러온 때와 달라졌거나 새 시안이면 이름을 묻고, 같은 상품·크기·이름이 이미 있으면 덮어쓸지 확인한다. `다른 이름으로 저장` 은 원본을 두고 새 시안을 만든다. `불러오기` 목록에서 초안을 열거나, `게시하기`/`내리기` 로 공개 여부를 바꾸거나, 지운다.
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
| GET    | `/almond-fonts`                                                                       | 공개                   |
| POST   | `/admin/almond-fonts` · DELETE `/admin/almond-fonts/:id`                              | `admin:template:write` |

스토어프론트 호출부는 `src/lib/api/ugc/almond-templates.ts`. 저장 전에 `lib/document.ts` 의 `parseDesign` 으로 고객 편집기가 여는 것과 같은 형식 검사를 한다.

## 올린 글꼴

디자이너는 텍스트 패널 아래 `올린 글꼴` 에서 TTF·OTF·WOFF·WOFF2(50MB 까지)를 올린다. 파일은 file-service `almond-template-font` 컨텍스트로 브라우저가 S3 에 직접 PUT 하고(서버액션 Lambda 상한 회피), 목록은 ugc `almond_fonts` 에 있다. 상업적 이용·웹 임베딩 확인 체크가 없으면 등록이 거절된다.

- 글꼴 이름은 `AF` + fileId 32자리다. 레이어 `fontFamily` 에 그대로 들어가고, 화면은 `FontFace` 로(`/api/almond-template/font/:id` 가 S3 로 302), 인쇄는 ugc-service 가 SVG 에서 이 이름을 찾아 파일을 받아 fontconfig 에 얹는다. 그래서 목록에서 뺀 글꼴도 이미 쓴 시안은 그대로 보이고 인쇄된다.
- pango 는 WOFF·WOFF2 를 못 읽어 인쇄 직전에 fonttools 로 TTF 로 푼다(ugc-service 이미지의 `py3-fonttools`).
- 목록 썸네일(`thumbnail.svg`)은 `<img>` 로 그려 웹폰트를 못 불러오므로 기본 고딕으로 보인다.

## 폴더

- `components/` 편집기(`editor/`), 목록(`gallery.tsx`), 색상 선택기, 레이어 렌더링
- `hooks/` 편집기 상태. 서버 저장·불러오기는 `use-template-storage.ts`
- `lib/` 문서 모델·검증(`document.ts`), 인쇄 상품 카탈로그(`catalog.ts`), 목록 필터
- `assets/` 클립아트·프레임 원본

## 한계

- 서버액션 본문 상한(`next.config.js` 의 `serverActions.bodySizeLimit`)이 12MB 라, 큰 이미지를 넣은 시안은 저장이 거절될 수 있다.
- SVG·JSON 은 인쇄 접수용 AI/EPS 가 아니다. 와우프레스 발주는 core `print-order` 가 결제 후 자동으로 처리한다. 품목 여는 절차와 운영은 [`apps/core/src/modules/print-order/README.md`](../../../../../apps/core/src/modules/print-order/README.md) 를 본다.
