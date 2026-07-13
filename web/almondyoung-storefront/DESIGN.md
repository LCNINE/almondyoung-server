# DESIGN.md — 아몬드영 스토어프론트 디자인 시스템 (Karrot / Seed Design 기반)

> UI(컴포넌트/화면/스타일)를 만들거나 수정할 때 **항상 이 문서를 따른다.**
> 원본: Karrot(당근) Seed Design System (https://seed-design.io). 아몬드영에 맞춰 토큰만 리매핑.
> 컬러/라운드/보더/포커스링은 `src/styles/globals.css` 의 CSS 변수로 이미 이 값에 매핑돼 있으니,
> **하드코딩 hex 대신 시맨틱 유틸(`bg-primary`, `text-foreground`, `border-border`, `bg-muted` …)을 써라.**

## 1. 원칙 (가장 중요)

1. **오렌지는 아껴 쓴다.** `#ff6600`(= `--primary`)는 Primary CTA·활성 상태·브랜드 순간에만. 배경/테두리 장식으로 뿌리지 않는다. 한 화면(주요 플로우)에 오렌지 강조는 사실상 하나.
2. **한 액센트, 한 시스템.** 두 번째 브랜드 색을 만들지 않는다. 성공/에러/정보는 시맨틱 색(아래)이지 브랜드가 아니다.
3. **4px 그리드.** 모든 padding/gap/height 는 `{4,8,12,16,20,24,32,40,48,56,64}` 중 하나. 벗어나면 이유를 주석으로.
4. **차분함 = 신뢰.** 경고 아이콘/빨강/배지 남발 금지. 빨강·경고 아이콘은 실제 에러에만.
5. **콘텐츠 우선, 크롬은 가볍게.** 커스텀 웹폰트 X (Pretendard/시스템폰트). 헤딩은 display face 대신 weight 700.
6. **모바일 우선.** 375px 기준으로 먼저, 16px 좌우 거터.

## 2. 컬러 (globals.css 토큰에 매핑됨 → 유틸 클래스로 사용)

| 역할 | HEX | 유틸 클래스 | 비고 |
|---|---|---|---|
| Primary / 브랜드 | `#ff6600` | `bg-primary` `text-primary` `border-primary` | CTA·활성. pressed `#e14d00` |
| Primary hover | `#e14d00` | `hover:bg-primary/90` 또는 `#e14d00` | |
| 배경(캔버스) | `#ffffff` | `bg-background` | |
| 헤딩/본문 진한 | `#1a1c20` | `text-foreground` | warm near-black. **순수 #000 금지** |
| 본문 보조 | `#555d6d` | `text-muted-foreground`(약간 밝음) | 2차 본문 |
| 캡션/3차 | `#868b94` | `text-muted-foreground` | 타임스탬프·메타 |
| placeholder | `#b0b3ba` | `placeholder:text-[#b0b3ba]` | |
| surface(옅은 면) | `#f7f8f9` | `bg-muted` | 입력 배경·본문 캔버스 |
| surface-fill | `#f3f4f5` | `bg-secondary` `bg-accent` | 뉴트럴 버튼·칩·비활성 |
| hairline(보더) | `#dcdee3` | `border-border` `border` | 구분선·기본 테두리 |
| 브랜드 틴트 | `#fff2ec` | `bg-[#fff2ec]` | 아주 옅은 오렌지 배경 |
| error | `#fa342c` | `text-destructive` `bg-destructive` | |
| info | `#217cf9` | `text-[#217cf9]` | 링크·정보 |
| success | `#079171` | `text-[#079171]` | 완료 |
| focus ring | `#5e98fe` | `focus-visible:ring-ring` | 키보드 포커스 |

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

- 최대 26px, 그 이상 금지. Light/ExtraBold 금지.

## 4. 컴포넌트 규격

- **Primary CTA**: `bg-primary text-white`, 높이 52px(`h-[52px]`), radius 12px(`rounded-xl`), 16px/700. pressed `#e14d00`. disabled `bg-[#f3f4f5] text-[#d1d3d8]`.
- **Neutral 버튼**: `bg-secondary text-foreground`(`#f3f4f5`), radius 8px(`rounded-lg`).
- **Outline 버튼**: `bg-transparent text-foreground border border-border`, radius 8px.
- **Critical 버튼**: `bg-destructive text-white`, radius 8px. 삭제/신고 등.
- **카드**: `bg-white border border-border rounded-lg`(8px) 또는 shadow-s2, featured는 `rounded-xl`(12px).
- **칩/태그**: `bg-secondary text-foreground rounded-full h-8 px-3`, 13px/500. 선택 시 `bg-foreground text-white`.
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

- DO: 시맨틱 유틸(`bg-primary`, `text-foreground`, `border-border`) 사용, 4px 그리드, 오렌지는 CTA에만, Pretendard.
- DON'T: 하드코딩 hex(특히 옛 `#f29219`), 두 번째 브랜드색, 순수 검정 텍스트, 26px 초과, s3보다 강한 그림자, 스프링 모션.

## 8. Voice & Tone (마이크로카피)

- 따뜻하고 담백하게. 존댓말이되 과한 사과/마케팅 어투 금지.
- 금지: `불편을 드려 죄송합니다`, `데이터가 없습니다`, `오류가 발생했습니다`, `혁신적인`, `Oops, something went wrong`.
- 에러: 구체적·비난없이·행동가능하게 (`다시 시도해 주세요`). 성공: 과거형 한 문장(`완료되었어요`), 요란하지 않게.
- CTA: 동사 우선(`구독하기`, `결제하기`). 빈 상태: 왜 비었는지 한 줄 + 낮은 압박의 다음 행동.
