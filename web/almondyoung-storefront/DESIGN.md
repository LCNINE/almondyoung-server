# DESIGN.md — 아몬드영 스토어프론트 디자인 시스템 (Karrot / Seed Design 기반)

> UI(컴포넌트/화면/스타일)를 만들거나 수정할 때 **항상 이 문서를 따른다.**
> auth-web(로그인·회원가입)과 wallet-web(결제)도 이 문서를 정본으로 따른다. admin-web 은 대상이 아니다.
> 기본 토큰은 Karrot(당근) Seed Design System (https://seed-design.io)을 사용하고, 브랜드 색은 [스토어 UI 피그마](https://www.figma.com/design/VDeCQFDnT05Hxrc8c78KAd/AlmondYoung_Store-Admin_UI?node-id=2-4528)를 따른다.
> 컬러/라운드/보더/포커스링은 `src/styles/globals.css` 의 CSS 변수로 이미 이 값에 매핑돼 있으니,
> **하드코딩 hex 대신 시맨틱 유틸(`bg-primary`, `text-foreground`, `border-border`, `bg-muted` …)을 써라.**

## 1. 원칙 (가장 중요)

1. **색은 라이브 팔레트를 역할로 쓴다.** 기본 버튼·강조는 주황(`--primary` = `#ffa500`), 헤더·공지 띠는 스톤, 할인·타임세일은 빨강이다. `mint`·`pink`·`purple`·`ink` 토큰 이름은 역할 이름으로 남아 있고 값은 라이브 색이다(아래 2장 표). 역할 밖에서 장식으로 뿌리지 않는다.
2. **주황 글자는 아껴 쓴다.** 흰 바탕 위 긴 글자는 대비가 낮아 `text-mint-deep`(`#a86200`)을 쓰고, 순 주황 글자는 가격·강조 낱말처럼 짧은 곳에만 쓴다. 성공/에러/정보는 시맨틱 색(아래)이지 브랜드가 아니다.
3. **4px 그리드.** 모든 padding/gap/height 는 `{4,8,12,16,20,24,32,40,48,56,64}` 중 하나(28·36·44·52 처럼 4의 배수면 된다). 작은 컨트롤 안의 2px 보정, 진행 막대 같은 3px 선은 예외. `px-[5px]`·`py-[7px]`·`h-[39px]` 같은 홀수 값은 가까운 4의 배수로 맞춘다. 벗어나면 이유를 주석으로.
4. **차분함 = 신뢰.** 경고 아이콘/빨강/배지 남발 금지. 빨강·경고 아이콘은 실제 에러에만.
5. **콘텐츠 우선, 크롬은 가볍게.** 커스텀 웹폰트 X (Pretendard/시스템폰트). 헤딩은 display face 대신 weight 700.
6. **모바일 우선.** 375px 기준으로 먼저, 16px 좌우 거터.

## 2. 컬러 (globals.css 토큰에 매핑됨 → 유틸 클래스로 사용)

| 역할 | HEX | 유틸 클래스 | 비고 |
|---|---|---|---|
| Primary | `#ffa500` | `bg-primary` `text-primary` | 기본 버튼, 강조, 카테고리 타일 |
| Primary hover | 주황 90% | `hover:bg-primary/90` | |
| header-background | `#57534e` | `bg-header-background` | 헤더 바탕(스톤) |
| header-border | `#44403c` | `bg-header-border` | 공지 띠 바탕 |
| ink | `#20232a` | `text-ink` `bg-ink` | 진한 글자, 고른 칩 바탕 |
| mint (=강조) | `#ffa500` | `bg-mint` `text-mint` | 섹션 제목 강조 낱말, 활성 탭 밑줄, 진행 막대, 고른 로고 링 |
| mint-deep | `#a86200` | `text-mint-deep` | 흰 바탕 위 긴 강조 글자 |
| mint-tint | `#fff7e5` | `bg-mint-tint` | 옅은 강조 바탕 |
| pink (=할인) | `#fa342c` | `bg-pink` | 할인·경고 면 |
| pink-deep | `#c7321f` | `text-pink-deep` `bg-pink-deep` | 할인액, "○원 아껴요" |
| pink-tint | `#feeceb` | `bg-pink-tint` | |
| purple (=멤버십) | `#ffa500` | `bg-purple` `text-purple-deep` | 멤버십 가격·라벨은 라이브처럼 주황 |
| purple-tint | `#fff7e5` | `bg-purple-tint` | 멤버십 영역 바탕 |
| 배경(캔버스) | `#ffffff` | `bg-background` | |
| 헤딩/본문 진한 | `#000000` | `text-foreground` | 라이브와 같은 검정. 섹션 제목도 검정 |
| 본문 보조·캡션 | `#757575` | `text-muted-foreground` | 피그마 버튼 보조 텍스트·메타 |
| placeholder | `#b0b3ba` | `placeholder:text-[#b0b3ba]` | |
| surface(옅은 면) | `#f7f8f9` | `bg-muted` | 입력 배경·본문 캔버스 |
| surface-fill | `#f3f4f5` | `bg-secondary` `bg-accent` | 뉴트럴 버튼·칩·비활성 |
| hairline(보더) | `#d9d9d9` | `border-border` `border` | 피그마 버튼 중립 테두리 |
| error | `#fa342c` | `text-destructive` `bg-destructive` | |
| info | `#217cf9` | `text-[#217cf9]` | 링크·정보 |
| success | `#079171` | `text-[#079171]` | 완료 |
| focus ring | `#5e98fe` | `focus-visible:ring-ring` | 키보드 포커스 |
| 별점 | `#ffa500` | 라이브 별점 컴포넌트 그대로 | |

## 3. 타이포 (시스템폰트, weight는 400/500/700만)

| 역할 | size | weight | line | 용도 |
|---|---|---|---|---|
| display-xl | 26 | 700 | 35 | 히어로 |
| display-large | 24 | 700 | 32 | 섹션 헤더 |
| heading-large | 20 | 700 | 27 | 카드 헤딩 |
| heading | 18 | 700 | 24 | 리스트 섹션 헤더 |
| title | 16 | 500 | 22 | 네비·기본 타이틀 |
| body | 14 | 400 | 19 | 기본 본문 (Tailwind `text-sm`) |
| body-small | 13 | 400 | 18 | 보조·메타 |
| caption | 12 | 400 | 16 | 라벨 |

- 최대 26px, 그 이상 금지. Light/ExtraBold 금지. `font-extrabold`·`font-black`·`font-[800]` 은 쓰지 않는다. 제목도 700 이 끝이다.
- 자간: 16px 미만 글자는 0. 18~28px 제목은 `tracking-[-0.01em]` 까지만. `-0.02em` 이상 좁히는 건 40px 이상 큰 글자에만 쓴다(이 문서 기준으론 쓸 일이 없다). `tracking-tight` 도 같은 이유로 쓰지 않는다.

## 4. 컴포넌트 규격

- **Primary CTA**: `bg-primary text-primary-foreground`(주황 바탕 흰 글자), 높이 52px(`h-[52px]`), radius 12px(`rounded-xl`), 16px/700. hover `bg-primary/90`, pressed `bg-primary/80`.
- **멤버십 버튼**: `bg-primary text-white`(라이브처럼 주황). 여러 곳에 반복되면 `components/ui/button` 은 두고 `components/shared` 래퍼에서 `className` 으로 확장. disabled `bg-[#f3f4f5] text-[#d1d3d8]`.
- **Neutral 버튼**: `bg-secondary text-foreground`(`#f3f4f5`), radius 8px(`rounded-lg`).
- **Outline 버튼**: `bg-transparent text-foreground border border-border`, radius 8px.
- **Critical 버튼**: `bg-destructive text-white`, radius 8px. 삭제/신고 등.
- **카드**: `bg-white border border-border rounded-lg`(8px) 또는 shadow-s2, featured는 `rounded-xl`(12px).
- **칩/태그**: `bg-secondary text-foreground rounded-full h-8 px-3`, 13px/500. 선택 시 `bg-ink text-white`.
- **입력**: `bg-muted border border-border rounded-lg`, focus `ring-2 ring-ring`, error `border-destructive`.

## 5. 레이아웃 / 뎁스 / 라운드

- 좌우 거터 16px 고정. 웹 콘텐츠 max-width ~640px, 중앙 정렬.
- radius: 8px(버튼/입력/기본카드) · 12px(큰버튼/featured, `--radius`=0.75rem) · 16px(큰카드) · 24px(다이얼로그, `rounded-3xl`) · 9999px(칩/아바타).
- shadow 3단계만: s1 `0 1px 4px rgba(0,0,0,.08)`(hover) · s2 `0 2px 10px rgba(0,0,0,.1)`(카드) · s3 `0 4px 16px rgba(0,0,0,.12)`(플로팅/시트/모달). 브랜드 틴트 그림자 금지.

## 6. 모션

- duration: fast 150ms(hover/press) · standard 250ms(기본) · slow 350ms(강조) · page 300ms.
- easing: enter `cubic-bezier(0,0,.2,1)` · exit `cubic-bezier(.4,0,1,1)` · standard `cubic-bezier(.4,0,.2,1)`.
- **스프링/오버슈트 금지.** `prefers-reduced-motion` 시 전부 0ms + 크로스페이드.

## 7. Do / Don't

- DO: 시맨틱·역할 토큰 유틸(`bg-primary`, `text-mint`, `text-mint-deep`, `bg-header-background` …) 사용, 색은 2장 역할대로, 4px 그리드, Pretendard.
- DON'T: 하드코딩 hex(옛 `#ff6600`·`#f29219` 포함), 긴 본문을 순 주황 글자로, 26px 초과, s3보다 강한 그림자, 스프링 모션.

## 8. 홈 화면 규격 (라이브 색 시안 기준)

헤더와 색은 라이브 그대로 두고, 공지 띠와 섹션 모양만 새 시안을 따른다.

- **헤더**: 라이브 헤더(스톤 바탕, 주황 카테고리 타일, 흰 검색창). 그 위에 3색 줄(주황 5 : 연노랑 3 : 스톤 2, 3px)과 공지 띠(`bg-header-border`). 모바일 공지 띠는 "자세히 보기" 글자 대신 화살표만 둔다. 모바일 헤더는 사람·장바구니 아이콘만.
- **섹션 제목** (`domains/home/components/header`): 26px/700 검정(모바일 20px), 강조 낱말만 `text-mint`(`accent` prop). 더보기는 14px 회색 밑줄, 모바일은 제목 줄 오른쪽 위.
- **분류 탭**: 글자만 있는 밑줄 탭. 고른 탭은 700 검정에 3px 주황 밑줄, 나머지 500 회색. 모바일은 한 줄 가로 스크롤.
- **상품 카드 글자**: 라이브 카드(`prodcut-card/parts/product-info`)와 같다. 이름 14px 회색 한 줄, 판매가 16px 굵은 검정, 멤버십할인가는 주황 배지 + 15px 굵은 주황. 홈 v1 카드도 같은 규격.
- **순위 배지**: 라이브 그대로(검정 바탕, 12px 굵게, 모서리 없음, 모든 순위 같은 색).
- **내 분야**: 처음엔 알약 칩(모바일은 글자만)에서 고르고 "N개 분야 베스트 보기"를 누르면 접힌다. 접힌 뒤엔 "OO · OO 베스트" 제목 줄에 바꾸기 버튼. 1주일간 보지 않기는 모바일에서 × 버튼.
- **브랜드관**: 흰 카드(얇은 테두리)에 인기 상품 3개를 구분선 목록으로. 고른 로고는 흰 틈 + 주황 링. 모바일은 로고 줄을 위, 카드를 아래.
- **멤버십관**: 흰 바탕, 멤버십 상품 판매량순. PC 는 멤버십 띠배너를 섹션 안 상품 위에 두고 맨 아래 띠배너는 뺀다. 모바일은 가입 안내 없이 상품만.
- **캔바 디자인**: 4칸 캐러셀.
- **머신 회원가**: 스톤 옅은 바탕. 모바일은 화면 끝까지 꽉 찬 띠, 제목 22px, 작은 가입 버튼.
- **카카오톡·맨 위로 버튼**: 같은 크기(모바일 44px, PC 52px). 카카오톡은 `#FEE500` 바탕.

## 9. Voice & Tone (마이크로카피)

- 따뜻하고 담백하게. 존댓말이되 과한 사과/마케팅 어투 금지.
- 금지: `불편을 드려 죄송합니다`, `데이터가 없습니다`, `오류가 발생했습니다`, `혁신적인`, `Oops, something went wrong`.
- 에러: 구체적·비난없이·행동가능하게 (`다시 시도해 주세요`). 성공: 과거형 한 문장(`완료되었어요`), 요란하지 않게.
- CTA: 동사 우선(`구독하기`, `결제하기`). 빈 상태: 왜 비었는지 한 줄 + 낮은 압박의 다음 행동.
