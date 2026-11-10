# DESIGN.md — 아몬드영 스토어프론트 디자인 시스템 (Karrot / Seed Design 기반)

> UI(컴포넌트/화면/스타일)를 만들거나 수정할 때 **항상 이 문서를 따른다.**
> 기본 토큰은 Karrot(당근) Seed Design System (https://seed-design.io)을 사용하고, 브랜드 색은 [스토어 UI 피그마](https://www.figma.com/design/VDeCQFDnT05Hxrc8c78KAd/AlmondYoung_Store-Admin_UI?node-id=2-4528)를 따른다.
> 컬러/라운드/보더/포커스링은 `src/styles/globals.css` 의 CSS 변수로 이미 이 값에 매핑돼 있으니,
> **하드코딩 hex 대신 시맨틱 유틸(`bg-primary`, `text-foreground`, `border-border`, `bg-muted` …)을 써라.**

## 1. 원칙 (가장 중요)

1. **색은 역할로 고른다.** 로고의 잉크·민트·핑크·퍼플을 아래 2장 표의 역할대로만 쓴다. 기본 버튼은 잉크(`--primary`), 활성·링크는 민트, 할인·NEW 는 핑크, 멤버십은 퍼플이다. 역할 밖에서 장식으로 뿌리지 않는다.
2. **흰 바탕 위 글자는 `*-deep` 만.** 원색(mint/pink/purple)은 흰 글자 대비가 4.5:1 에 못 미쳐 면(배경·배지·막대)에만 쓰고, 원색 면 위 글자는 흰색이 아니라 ink 다. 성공/에러/정보는 시맨틱 색(아래)이지 브랜드가 아니다.
3. **4px 그리드.** 모든 padding/gap/height 는 `{4,8,12,16,20,24,32,40,48,56,64}` 중 하나(28·36·44·52 처럼 4의 배수면 된다). 작은 컨트롤 안의 2px 보정, 진행 막대 같은 3px 선은 예외. `px-[5px]`·`py-[7px]`·`h-[39px]` 같은 홀수 값은 가까운 4의 배수로 맞춘다. 벗어나면 이유를 주석으로.
4. **차분함 = 신뢰.** 경고 아이콘/빨강/배지 남발 금지. 빨강·경고 아이콘은 실제 에러에만.
5. **콘텐츠 우선, 크롬은 가볍게.** 커스텀 웹폰트 X (Pretendard/시스템폰트). 헤딩은 display face 대신 weight 700.
6. **모바일 우선.** 375px 기준으로 먼저, 16px 좌우 거터.

## 2. 컬러 (globals.css 토큰에 매핑됨 → 유틸 클래스로 사용)

| 역할 | HEX | 유틸 클래스 | 비고 |
|---|---|---|---|
| Primary / ink | `#141617` | `bg-primary` `text-foreground` `bg-ink` | 기본 버튼, 글자, 공지 띠 바탕. 로고 워드마크 색 |
| Primary hover | ink 90% | `hover:bg-primary/90` | |
| mint | `#36C2B3` | `bg-mint` `border-mint` | 브랜드 강조 면: 선택 칩, 신상 태그, 활성 밑줄, 진행 막대, 1~3위 배지 |
| mint-deep | `#0B7366` | `text-mint-deep` | 흰 바탕 위 활성·링크·안내 글자, 선택 표시(라디오·테두리) |
| mint-tint | `#E7F7F4` | `bg-mint-tint` | 옅은 브랜드 면(옛 `bg-yellow-10` 자리) |
| pink | `#F779AC` | `bg-pink` | 장바구니 개수, NEW 배지 면 |
| pink-deep | `#C2306C` | `text-pink-deep` `bg-pink-deep` | 할인율·할인액, 타임세일 시간 배지, "○원 아껴요" |
| pink-tint | `#FDECF3` | `bg-pink-tint` | |
| purple | `#9C7FCB` | `bg-purple` | 장식. 어두운 바탕 위 멤버십 글자 |
| purple-deep | `#5B3F96` | `text-purple-deep` `bg-purple-deep` | 멤버십 가격·라벨·버튼 전부 |
| purple-tint | `#F2EEFA` | `bg-purple-tint` | 멤버십 영역 바탕 |
| 배경(캔버스) | `#ffffff` | `bg-background` | |
| 헤딩/본문 진한 | `#141617` | `text-foreground` | 순수 검정 대신 ink |
| 본문 보조·캡션 | `#757575` | `text-muted-foreground` | 피그마 버튼 보조 텍스트·메타 |
| placeholder | `#b0b3ba` | `placeholder:text-[#b0b3ba]` | |
| surface(옅은 면) | `#f7f8f9` | `bg-muted` | 입력 배경·본문 캔버스 |
| surface-fill | `#f3f4f5` | `bg-secondary` `bg-accent` | 뉴트럴 버튼·칩·비활성 |
| hairline(보더) | `#d9d9d9` | `border-border` `border` | 피그마 버튼 중립 테두리 |
| error | `#fa342c` | `text-destructive` `bg-destructive` | |
| info | `#217cf9` | `text-[#217cf9]` | 링크·정보 |
| success | `#079171` | `text-[#079171]` | 완료 |
| focus ring | `#0b7366` | `focus-visible:ring-ring` | 키보드 포커스 (mint-deep) |
| 별점 | ink | `fill-ink text-ink` | 노란 별 쓰지 않음 |

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

- **Primary CTA**: `bg-primary text-primary-foreground`(ink 바탕 흰 글자), 높이 52px(`h-[52px]`), radius 12px(`rounded-xl`), 16px/700. hover `bg-primary/90`, pressed `bg-primary/80`.
- **멤버십 버튼**: `bg-purple-deep text-white`. 여러 곳에 반복되면 `components/ui/button` 은 두고 `components/shared` 래퍼에서 `className` 으로 확장. disabled `bg-[#f3f4f5] text-[#d1d3d8]`.
- **Neutral 버튼**: `bg-secondary text-foreground`(`#f3f4f5`), radius 8px(`rounded-lg`).
- **Outline 버튼**: `bg-transparent text-foreground border border-border`, radius 8px.
- **Critical 버튼**: `bg-destructive text-white`, radius 8px. 삭제/신고 등.
- **카드**: `bg-white border border-border rounded-lg`(8px) 또는 shadow-s2, featured는 `rounded-xl`(12px).
- **칩/태그**: `bg-secondary text-foreground rounded-full h-8 px-3`, 13px/500. 선택 시 `bg-mint text-ink`.
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

- DO: 시맨틱·로고 토큰 유틸(`bg-primary`, `text-mint-deep`, `text-purple-deep` …) 사용, 색은 2장 역할대로, 4px 그리드, Pretendard.
- DON'T: 하드코딩 hex(특히 옛 주황 `#ffa500`·`#ff6600`·`#f29219`, `yellow-*` 유틸), 흰 바탕 위 원색 글자, 강조 글자에 `text-primary`(이제 검정이다), 26px 초과, s3보다 강한 그림자, 스프링 모션.

## 8. 홈 리브랜딩 다듬기 — 코드에 아직 반영 안 된 것

홈 시안을 3장 타이포·1장 4px 그리드 기준으로 다듬었다(제목 800→700, 제목 자간 -0.03em→-0.01em, 홀수 간격을 4의 배수로, 화면 문구 끝 느낌표 제거). 색·레이아웃·글꼴·이미지는 그대로다. 같은 수정을 아래 코드에 넣어야 시안과 화면이 맞는다.

**굵기 800 → 700** (`font-extrabold`·`font-black` → `font-bold`)
- `components/layout/header/main-header/service-bar.tsx` — NEW 배지
- `components/layout/footer/index.tsx` — 고객센터 전화번호 등
- `components/search/search-hot-keyword/index.tsx`
- `domains/home/template/brand-showcase/brand-hall.tsx`
- `domains/home/template/shop-trade/shop-trade-card.tsx`
- `domains/membership-hall/components/hall-header.tsx`
- `domains/mypage/components/desktop/user-profile-section.tsx`, `domains/mypage/components/mobile/mobile-header.tsx`

**제목 자간 → `tracking-[-0.01em]`**
- `domains/home/components/header/index.tsx` — 홈 섹션 제목
- `domains/home/components/interest/interest-selector-banner.tsx`
- `domains/home/template/member-savings/index.tsx`
- `domains/membership-hall/components/hall-header.tsx`
- `components/layout/footer/index.tsx` — 전화번호(-0.02em)

**홈·헤더의 홀수 간격 → 4의 배수**
- `components/layout/header/main-header/service-bar.tsx`, `user-actions.tsx` — `px-[5px]` → `px-1`
- `components/layout/header/main-header/category-nav.tsx` — `px-[9px]` → `px-2`
- `domains/home/components/interest/interest-key-chips.tsx` — 선택 칩이 2px 테두리만큼 `px-[5px] pt-[13px] pb-[11px]` 로 여백을 깎던 것을, 테두리는 1px 그대로 두고 `ring-1 ring-inset` 으로 두껍게 보이게 바꾼다. 여백 보정이 사라져 선택해도 내용이 흔들리지 않는다
- `domains/home/template/shop-trade/shop-trade-card.tsx` — `px-[7px]` → `px-2`
- `domains/home/components/v1-card/index.tsx` — `h-[39px]` → `h-10`
- `domains/home/components/class-list/index.tsx`, `domains/home/components/quick-links/index.tsx` — `py-[3px]` → `py-1`

**문구**
- 멤버십 띠배너 이름 끝 느낌표 제거(`추가혜택 받으세요!` → `추가혜택 받으세요`). 코드가 아니라 어드민 배너 이름이라 어드민에서 고친다. 이 이름이 이미지 대체 텍스트로 나간다

남은 곳은 아래 명령으로 다시 뽑는다. 체크아웃·마이페이지·설문 화면의 홀수 간격은 이번 홈 범위 밖이라 그 화면을 고칠 때 같이 맞춘다.

```bash
cd web/almondyoung-storefront/src
grep -rn -E 'font-(extrabold|black)|font-\[(800|900)\]' --include='*.tsx' . | grep -v '/ui/'
grep -rn -E 'tracking-tight|tracking-\[-0\.0[2-9]em\]' --include='*.tsx' . | grep -v '/ui/'
grep -rn -o -E '\b(p|px|py|pt|pb|pl|pr|m[xytblr]?|gap(-[xy])?|h|w)-\[(1|3|5|7|9|11|13|15|17|19|21|23|25|27|29|31|33|35|37|39)px\]' --include='*.tsx' domains/home components/layout
```

## 9. Voice & Tone (마이크로카피)

- 따뜻하고 담백하게. 존댓말이되 과한 사과/마케팅 어투 금지.
- 금지: `불편을 드려 죄송합니다`, `데이터가 없습니다`, `오류가 발생했습니다`, `혁신적인`, `Oops, something went wrong`.
- 에러: 구체적·비난없이·행동가능하게 (`다시 시도해 주세요`). 성공: 과거형 한 문장(`완료되었어요`), 요란하지 않게.
- CTA: 동사 우선(`구독하기`, `결제하기`). 빈 상태: 왜 비었는지 한 줄 + 낮은 압박의 다음 행동.
