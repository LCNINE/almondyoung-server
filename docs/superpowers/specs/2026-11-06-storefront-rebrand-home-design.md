# 스토어프론트 메인 리브랜딩 (새 로고 적용) 설계

작성일: 2026-11-06
대상: `web/almondyoung-storefront` 메인(홈) 화면, 공통 헤더·푸터, 신규 멤버십관 페이지

## 0. 시안

- 확정 시안 (PC·모바일 전환, 비회원/멤버십 회원 보기 전환): https://claude.ai/artifact/BB1u77MXRPV5hQKVgYTYJb
- 비교용 이전 시안: https://claude.ai/artifact/ChXUpniEPJ9x3YfwiZhX6W

시안의 상품·배너·카테고리·샵매매·브랜드 데이터는 2026-11-06 라이브(almondyoung.com/kr) 화면에서 가져온 실데이터다. 구현은 시안을 그대로 옮기되, 데이터는 기존 서버 컴포넌트·API 를 그대로 쓴다.

## 1. 색 (새 로고 기준)

로고 워드마크의 잉크색과 A·Y 획의 세 색을 역할별로 나눈다. 기존 `DESIGN.md` 의 "브랜드 색은 하나만" 원칙(주황 `--primary`)을 아래 역할 표로 바꾼다. 구현 첫 단계에서 `DESIGN.md` 와 `src/styles/globals.css` 토큰을 함께 고친다.

| 토큰 | 값 | 역할 |
|---|---|---|
| ink | `#141617` | 글자, 기본 버튼, 공지 띠·전체 카테고리 버튼 배경 |
| mint | `#36C2B3` | 브랜드 강조 면(신상 태그, 활성 밑줄, 진행 막대, 1~3위 순위 배지) |
| mint-deep | `#0B7366` | 흰 바탕 위 민트 글자(메가메뉴 활성, 지역 태그) |
| pink | `#F779AC` | 장바구니 개수, NEW 배지 |
| pink-deep | `#C2306C` | 할인율, 멤버십 특가 시간 배지, "○원 아껴요" |
| purple | `#9C7FCB` | 장식 |
| purple-deep | `#5B3F96` | 멤버십 관련 글자·버튼 전부(멤버십할인가, 멤버십관) |
| *-tint | mint `#E7F7F4` / pink `#FDECF3` / purple `#F2EEFA` | 연한 면 |

- 흰 바탕 위 글자에는 원색(mint/pink/purple)을 쓰지 않는다. 대비가 4.5:1 에 못 미친다. 글자는 `*-deep` 만 쓴다.
- 민트 면 위 글자는 흰색이 아니라 ink 다.

### 1-1. 토큰 변경안 (`src/styles/globals.css`, `DESIGN.md`)

기존 시맨틱 유틸(`bg-primary`, `text-primary` …)은 이름을 그대로 두고 값만 바꾼다. 쓰는 곳을 고치지 않아도 사이트 전체가 한 번에 바뀌게 하기 위해서다. 로고 색은 새 토큰으로 더한다.

| 토큰 | 지금 | 바꿀 값 | 결과 |
|---|---|---|---|
| `--primary` | `#ffa500` (주황) | `#141617` (ink) | 결제·담기 같은 주요 버튼이 주황 → 검정. 흰 글자 대비 충족 |
| `--primary-foreground` | `#ffffff` | 그대로 | |
| `--foreground` | `#000000` | `#141617` | 순수 검정 → 로고 워드마크 색 |
| `--yellow-10` (브랜드 옅은 면) | `#fff7e5` | 쓰는 곳을 `--mint-tint` 로 옮긴 뒤 삭제 | |
| `--ring` (포커스) | `#5e98fe` | `#0b7366` (mint-deep) | |
| 신규 `--mint` / `--mint-deep` / `--mint-tint` | 없음 | `#36c2b3` / `#0b7366` / `#e7f7f4` | `bg-mint`, `text-mint-deep` … |
| 신규 `--pink` / `--pink-deep` / `--pink-tint` | 없음 | `#f779ac` / `#c2306c` / `#fdecf3` | |
| 신규 `--purple` / `--purple-deep` / `--purple-tint` | 없음 | `#9c7fcb` / `#5b3f96` / `#f2eefa` | |
| `--secondary` `--muted` `--border` `--destructive` | 그대로 | 그대로 | |

### 1-2. shadcn/ui 토큰 전체 매핑

shadcn/ui 컴포넌트는 색을 직접 쓰지 않고 시맨틱 토큰(`bg-primary`, `ring`, `bg-accent` …)으로 칠한다. 그래서 `src/components/ui` 소스는 건드리지 않고 `globals.css` 토큰 값만 바꾼다(스토어프론트 규칙: ui 소스 직접 수정 금지). shadcn 에는 브랜드 색 자리가 `primary` 하나뿐이라, 로고의 민트·핑크·퍼플은 같은 방식으로 토큰을 새로 더한다.

| shadcn 토큰 | 지금 | 바꿀 값 | 이유 |
|---|---|---|---|
| `--primary` | `#ffa500` | `#141617` | 기본 버튼. 흰 글자 대비가 되는 건 잉크뿐 |
| `--primary-foreground` | `#ffffff` | 그대로 | |
| `--foreground` `--card-foreground` `--popover-foreground` | `#000000` | `#141617` | 로고 워드마크 색과 통일 |
| `--background` `--card` `--popover` | `#ffffff` | 그대로 | |
| `--secondary` / `--secondary-foreground` | `#f3f4f5` / `#000000` | 그대로 / `#141617` | 회색 보조 버튼 |
| `--muted` / `--muted-foreground` | `#f7f8f9` / `#757575` | 그대로 | |
| `--accent` / `--accent-foreground` | `#f3f4f5` / `#000000` | 그대로 / `#141617` | shadcn 의 accent 는 메뉴·리스트 hover 배경이라 회색이 맞다. 브랜드 강조색이 아니다 |
| `--destructive` | `#fa342c` | 그대로 | 에러·삭제는 브랜드 색으로 칠하지 않는다 |
| `--border` `--input` | `#d9d9d9` | 그대로 | |
| `--ring` | `#5e98fe` | `#0b7366` | 키보드 포커스를 브랜드 색으로 |
| `--chart-1`~`5` | 주황 계열 oklch | `#36c2b3` `#f779ac` `#9c7fcb` `#141617` `#9a9fa6` | 차트도 로고 색 순서로 |
| `--sidebar-primary` | `#000000` | `#141617` | |
| `--sidebar-ring` | (현재 값) | `#0b7366` | `--ring` 과 같게 |

### 1-3. 가이드 토큰 CSS

`src/styles/globals.css` 에 들어갈 모양. 기존 `:root` 안의 값을 바꾸고 로고 토큰을 더하며, `@theme inline` 에 등록해 Tailwind 유틸(`bg-mint`, `text-mint-deep`, `bg-purple-tint` …)을 만든다.

```css
:root {
  /* shadcn 시맨틱 토큰: 값만 바꾼다 */
  --background: #ffffff;
  --foreground: #141617;
  --card: #ffffff;
  --card-foreground: #141617;
  --popover: #ffffff;
  --popover-foreground: #141617;
  --primary: #141617;
  --primary-foreground: #ffffff;
  --secondary: #f3f4f5;
  --secondary-foreground: #141617;
  --muted: #f7f8f9;
  --muted-foreground: #757575;
  --accent: #f3f4f5;
  --accent-foreground: #141617;
  --destructive: #fa342c;
  --border: #d9d9d9;
  --input: #d9d9d9;
  --ring: #0b7366;
  --chart-1: #36c2b3;
  --chart-2: #f779ac;
  --chart-3: #9c7fcb;
  --chart-4: #141617;
  --chart-5: #9a9fa6;

  /* 로고 토큰: 새로 더한다
     원색 = 면(배경·배지·막대)에만, 그 위 글자는 ink
     deep = 흰 바탕 위 글자
     tint = 넓은 바탕 면 */
  --ink: #141617;
  --mint: #36c2b3;
  --mint-deep: #0b7366;
  --mint-tint: #e7f7f4;
  --pink: #f779ac;
  --pink-deep: #c2306c;
  --pink-tint: #fdecf3;
  --purple: #9c7fcb;
  --purple-deep: #5b3f96;
  --purple-tint: #f2eefa;
}

@theme inline {
  --color-ink: var(--ink);
  --color-mint: var(--mint);
  --color-mint-deep: var(--mint-deep);
  --color-mint-tint: var(--mint-tint);
  --color-pink: var(--pink);
  --color-pink-deep: var(--pink-deep);
  --color-pink-tint: var(--pink-tint);
  --color-purple: var(--purple);
  --color-purple-deep: var(--purple-deep);
  --color-purple-tint: var(--purple-tint);
}
```

역할별 쓰는 법:

| 쓰임 | 유틸 |
|---|---|
| 기본 버튼 | `Button` 기본(variant default) 그대로 → 잉크 |
| 선택 상태·활성 탭 밑줄·신상 태그 면 | `bg-mint text-ink` / `border-mint` |
| 흰 바탕 위 링크·활성 글자 | `text-mint-deep` |
| 할인율·타임세일 시간 배지 | `text-pink-deep` / `bg-pink-deep text-white` |
| 멤버십 가격·라벨·버튼 | `text-purple-deep` / `bg-purple-deep text-white` |
| 멤버십 영역 바탕 | `bg-purple-tint` |
| 멤버십 버튼이 여러 곳에 반복되면 | `components/ui/button` 은 그대로 두고 래퍼(`components/shared/membership-button.tsx` 등)에서 `className` 으로 확장 |

다크 테마(`.dark`)는 `--primary` 를 `#36c2b3`(면) + `--primary-foreground: #141617` 로 두고, 로고 토큰은 deep 대신 원색을 글자에 쓴다(어두운 바탕에서는 원색이 충분히 읽힌다).

### 1-4. 강조용 `text-primary` 옮기기

- `text-primary` 를 "강조색 글자"로 쓰던 곳(활성 탭, 링크, 가격 강조)은 값이 검정으로 바뀌어 강조가 사라진다. 이런 곳은 역할에 맞게 `text-mint-deep`(활성·링크) / `text-purple-deep`(멤버십) / `text-pink-deep`(할인·타임세일)으로 옮긴다. 목록은 `grep -rn "text-primary" src` 로 뽑는다
- 다크 테마의 `--primary` 도 같은 기준으로 바꾼다(다크 바탕에서는 mint 면 + ink 글자)
- `DESIGN.md` 1장 원칙 1·2(오렌지는 아껴 쓴다 / 한 액센트)를 1장 표의 역할 규칙으로 바꾼다

## 2. 화면 구조

### 2-1. 상단 (PC)

위에서부터:

1. 로고 3색 띠 (3px, 5:3:2 비율 mint/pink/purple)
2. **상단 공지 띠** (ink 바탕) — 신규 기능, 3장 참고
3. 서비스 줄 (회색 띠): 아몬드영 플레이, 예약관리어플(다뷰), 미용필기시험 NEW, 뷰티탑 NEW, 아몬드템플릿 / 오른쪽 고객센터, KO. 주문배송은 주문조회와 겹쳐서 뺀다
4. 흰 헤더: 로고(밝은 배경용), 둥근 검색창(테두리 ink 2px, placeholder "오늘 뭐 살까? 아몬드영"), 로그인·주문조회·장바구니
5. 카테고리 줄: ink "전체 카테고리" 버튼 + 고정 카테고리 8개(속눈썹펌~왁싱, 아이콘 포함) / 오른쪽 샵매매, 브랜드관, 멤버십관(purple-deep)

헤더(4·5)는 스크롤 시 상단 고정.

### 2-2. 전체 카테고리 메뉴 (PC)

기존 `src/components/category/dropdown/mega-menu.tsx` 를 그대로 쓴다. 수치는 바꾸지 않는다(대분류 칸 168px, 줄 높이 28px, 글자 12px, 아이콘 16px, 펼침 영역 592px, 중·소분류 160px, 대표 이미지 최대 320px, 최소 높이 500px). 바꾸는 것은 두 가지다.

- 트리거: 헤더 타일(주황 정사각)이 아니라 카테고리 줄 왼쪽의 ink 버튼. 열렸을 때 mint 바탕 + ink 글자
- 활성 글자색: `text-primary`(주황) → mint-deep

### 2-3. 메인 섹션 순서

| 순서 | 섹션 | 기존 컴포넌트 | 변경 |
|---|---|---|---|
| 1 | 메인 배너 | `HeroBanner` | 컨테이너 안 슬라이드, 모서리 각지게(라운드 0, PC·모바일 모두). 오른쪽 아래 이전/번호/일시정지/다음, 아래 mint 진행 막대(5초). 모바일은 모바일용 이미지(780×360) |
| 2 | 뷰티탑 카드 | `BeautyTopHomeCard` | 홈에서 일단 뺐다(2026-11-06). 컴포넌트는 남겨 둠 |
| 3 | 타임세일 | `TimeSaleWrapper` | 카드 색만 교체(멤버십 특가 배지·할인율 pink-deep, 밑줄 탭 mint). 줄·칸·화살표·배경은 어드민 타임세일 편집기 설정(`Store.metadata.timeSaleSettings`)을 따른다. 배포 때 메인 PC 설정을 1줄 × 5칸, 화살표 켬, 흰 바탕으로 바꾼다(저장 즉시 라이브 반영이라 배포 전에 바꾸지 않는다) |
| 4 | 내 분야 상품만 모아볼까요? | `InterestCategoriesSlot` | 아이콘 카드 8개(재채색 아이콘). 동작은 그대로(쿠키 365일, 1주일간 보지 않기 7일) |
| 5 | 브랜드관 | `BrandShowcaseWrapper` | 개편. 2-4 참고 |
| 6 | 새로 들어온 상품 | `ShowcaseCategoryWrapper`(NEW_ARRIVALS) | 이전 시안 스타일: 5칸 2줄, 둥근 썸네일, mint 신상 태그. 모바일은 2줄 가로 캐러셀 |
| 7 | 카테고리 베스트 | `CategoryBestProductsWrapper` | 아이콘 달린 알약 탭, 1~10위 순위 배지(1~3위 mint) |
| 8 | 해외 직구 | `OverseasShowcaseWrapper` | 회색 면, 해외 칩, 순위 배지 |
| 9 | 머신은 회원가로 사면 차이가 커요 | 없음(신규 블록) | purple-tint 띠, 머신 4개 정가 취소선·멤버십할인가·"○원 아껴요". 모바일은 한 줄 캐러셀 |
| 10 | 아몬드템플릿 | `ShowcaseCategoryWrapper`(캔바) | 이전 시안 4칸. 모바일 한 줄 캐러셀 |
| 11 | 원데이 클래스 | `ShowcaseCategoryWrapper`(클래스) | 2단 목록(썸네일·지역 태그·제목·가격), 지역 탭. 모바일은 4개 + 클래스 더보기 |
| 12 | 매일 쓰는 샵 소모품 | 없음(신규 블록) | 6칸. 모바일 한 줄 캐러셀 |
| 13 | 샵매매 | `ShopTradeWrapper` | 회색 면, 4칸 캐러셀, 사진 수 배지, 양도(mint)/임대(purple) 태그 |
| 14 | 멤버십관 | 없음(신규 블록) | purple-tint 면, 가입 안내 줄, 멤버십 상품 캐러셀, 전체보기 → 멤버십관 페이지 |
| 15 | 멤버십 띠배너 | `MembershipBanner` | PC만. 모바일 숨김 |
| 16 | 푸터 | footer | 이전 시안: 링크 4개, 사업자 정보 3줄, 고객센터 번호, 카카오톡 채널·인스타그램 |

캐러셀 섹션은 PC 한 줄 5칸 + 좌우 원형 화살표, 모바일 42% 폭 가로 스크롤(스냅).

### 2-4. 브랜드관 (개편)

- 왼쪽 ink 카드: 고른 브랜드 로고·이름, "원장님들이 많이 찾은 상품" 3개(썸네일·이름·가격), mint "○○ 브랜드관 가기" 버튼
- 오른쪽: 브랜드 로고 타일(6칸). 누르면 왼쪽 카드가 그 브랜드로 바뀐다
- 데이터: 브랜드관 카테고리(`BRAND_CATEGORY_HANDLE`)의 자식 카테고리 = 브랜드. 상품 3개는 그 브랜드 카테고리의 판매량순 상위 3개(`/store/products-sorted` 의 판매량 정렬, 동률은 리뷰 수). 모든 브랜드에 상품이 떠야 한다
- 모바일: 로고 타일 2줄 가로 스크롤

### 2-5. 모바일

- 서비스 줄·카테고리 줄·전체 카테고리 버튼 숨김. 헤더는 로고 + 아이콘(간격 좁게) + 전폭 검색창
- 배너 아래 퀵링크 2줄 가로 스크롤(서비스 4개 + 카테고리 + 아몬드템플릿 + 멤버십관). NEW 배지가 잘리지 않게 위쪽 여백
- 하단 탭: 카테고리 / 검색 / 홈 / 장바구니 / 마이. 카테고리는 전체 화면 시트(왼쪽 대분류 42%, 오른쪽 하위 목록, 닫기)
- 공지 띠: 12px, 좌우 28px 여백, 말줄임

## 3. 신규 기능: 상단 공지 띠

지금은 없다. `site-popup`(팝업)과는 다른 기능이다.

- 공지가 여러 개면 4.5초마다 바뀐다. 지금 공지는 위로 천천히 올라가며 사라지고, 다음 공지는 아래에서 올라온다(전환 1.2초, ease). 공지 문구와 "자세히 보기" 링크만 보인다
- 공지가 하나면 움직이지 않는다. `prefers-reduced-motion` 이면 넘기지 않는다
- 데이터(2026-11-06 결정): 고객센터 공지(`notices`)에 얹지 않고 별도 테이블 `top_notices` 를 core catalog 모듈에 둔다. 띠에 올라가는 문구는 마케팅 문구(재출시·기획전)와 고객센터 공지(배송 지연 등) 둘 다라서, 공지 원문에 묶으면 마케팅 링크를 못 건다
  - 컬럼: 문구(짧게 한 줄), 링크 URL(선택. 상품·기획전·공지 상세 `/cs/notice/<id>` 무엇이든), 노출 시작·종료, 켜기, 순서, soft delete·감사 컬럼(`site_popups` 와 같은 모양)
  - 대상 구분은 두지 않는다. 비회원·회원·멤버십 모두 같은 띠를 본다. 그래서 서버가 보는 사람을 판별하지 않아도 된다
  - API: `GET /top-notices/public`(`@Public`, 켜짐·기간 안·순서대로). 관리 API 는 `site-popups` 와 같은 권한(`marketing.display.read`/`write`)
  - 스토어프론트: `(main)` 레이아웃 헤더 위에서 서버 컴포넌트가 60초 캐시로 받아 그린다. 받기 실패면 띠를 그리지 않는다. 링크가 없으면 "자세히 보기"를 숨긴다
- 관리자(admin-web): 마케팅 메뉴에 "상단 공지 띠" 목록 하나. 추가·수정·켜기/끄기·순서. 화면 권한은 `/mall/popups` 와 같다

### 3-1. 팝업 (기존 기능, 색만 바뀜)

`src/components/layout/site-popup` 은 그대로 쓴다. 구조·동작·대상 판별(서버에서 비로그인/회원/멤버십 판별)은 바꾸지 않는다.

- 화면 가운데 모달(16px 라운드, 최대 높이 90vh, 폭은 관리자가 정한 px, 화면보다 넓으면 `calc(100vw - 2rem)`)
- 머리: 제목 18px 굵게 / 여러 개면 ‹ 1/2 › / 닫기 X
- 본문: 글 팝업은 15px·줄 28px, 이미지 팝업은 관리자가 정한 높이
- 아래: 닫기(여러 개면 모두 닫기, `secondary`) + 이동 버튼(`primary`), 그 아래 "이 팝업 오늘 그만 보기" / "이 팝업 N일간 보지 않기"

토큰 교체(7장) 후 바뀌는 것:

| 요소 | 지금 | 바뀐 뒤 |
|---|---|---|
| 이동 버튼(자세히 보기 등) | `bg-primary` 주황 | 잉크(검정) |
| 포커스 테두리 | 파랑 | mint-deep |
| 제목·본문 글자 | `#000000` | `#141617` |

시안의 "팝업 다시 보기" 버튼으로 두 종류(글 팝업, 이미지 팝업)를 확인할 수 있다. 공지 띠와 팝업은 같은 페이지에 함께 떠도 서로 영향이 없다.

## 4. 신규 페이지: 멤버십관

지금은 전용 페이지가 없다(가장 가까운 것은 가입 완료 화면의 `/category/membership-canva`).

- 진입: 카테고리 줄 멤버십관, 모바일 퀵링크 멤버십관, 메인 멤버십관 섹션의 전체보기
- 화면: 경로 표시(홈 › 멤버십관) → purple-tint 머리 영역(심볼, 제목, 설명, 멤버십 가입하기 / 회원이면 내 멤버십 보기) → 탭(전체 / 멤버십 특가 / 멤버십할인가) + 상품 수 → 5칸 상품 그리드(모바일 2칸)
- 머리 영역 버튼: 회원 "내 멤버십 보기", 비회원 "멤버십 가입하기". 둘 다 `/mypage/membership`(회원 여부에 따라 가입 정보 / 혜택 안내+가입 화면을 그리는 기존 페이지)

### 4-1. 대상 상품과 조회 (2026-11-06 결정)

Medusa 에 멤버십관 전용 store 라우트를 새로 둔다. 관리자가 따로 설정할 것은 없다. 상품 등록 때 가격 규칙에 멤버십가를 넣고, 회원 타임세일을 지금처럼 만들면 자동으로 잡힌다.

- **멤버십 특가**: 진행 중 타임세일의 `membershipOnlyVariantIds` 상품(`listActiveStoreTimeSales`). 세일이 끝나면 자동으로 빠진다
- **멤버십할인가**: "Membership Prices" price list(회원 그룹 규칙) 가격이 기본가보다 싼 상품. 타임세일의 `listProductsInPriceLists` SQL 패턴을 재사용한다. 결제에 실제로 쓰이는 가격이 기준이라 화면과 결제가 어긋나지 않는다
  - core 의 `membership_price` 는 NOT NULL 이라 "값이 있다"로는 못 가른다. 반드시 `멤버십가 < 기본가` 로 판정한다
  - 그 목록이 비면 탭도 빈다(2026-06 에 행 27,001개 유실). 감시는 기존 `membership-price-display-audit` 잡이 한다
- **전체**: 두 탭의 합집합(상품 중복 제거)
- 회원 전용 상품 숨김·멤버십가 비공개("회원 공개")는 기존 store 미들웨어 규칙을 그대로 탄다
- 기존 `GET /store/membership-products` 는 이름과 달리 `/store/products` 프록시이고 아무도 부르지 않는다. 새 라우트로 대체하거나 이 경로를 그 역할로 바꾼다

### 4-2. 화면 동작

- **정렬**: 탭 줄 오른쪽에 "상품 N개" + 드롭다운. 판매량순(기본) → 할인율순(멤버십가 기준) → 최신순. 판매량순 동률은 리뷰 수, 최신순으로 가른다. 비회원에게 가격을 숨기는 상품도 순서는 같고 가격 자리만 "회원 공개"
- **진행 중인 멤버십 특가가 없으면** "멤버십 특가" 탭을 숨긴다. 전체에는 할인가 상품만 나온다
- **분야 칩**: 탭 아래 한 줄. 전체 + 메인 카테고리 줄과 같은 8개(속눈썹펌·속눈썹연장·반영구·네일아트·타투·피부미용·헤어·왁싱). 지금 탭에서 상품이 0개인 분야는 숨긴다. 선택 칩은 `bg-mint text-ink`. 판정은 상품의 카테고리(그 분야 아래 자손 포함)
- 모바일: 탭 아래 줄에 상품 수 왼쪽·정렬 오른쪽, 분야 칩은 가로 스크롤, 그리드 2칸

## 5. 상품 카드 (라이브 카드 그대로, 색만 교체)

라이브 타임세일 카드의 실측값을 그대로 쓴다. 메인 캐러셀 섹션 전부에 적용한다(6·9·10·12 블록은 이전 시안 카드).

| 요소 | 규격 |
|---|---|
| 글꼴 | Pretendard |
| 상품명 | 14px / 700 / 17.5px, 한 줄 말줄임, 이미지 아래 16px |
| 가격 | 17px / 700, 할인율은 pink-deep 으로 앞에 |
| 라벨 줄 | 11px / 700, 11px 원 안에 흰 체크(8px), 간격 3px. 멤버십할인가 / 멤버십 특가 |
| 멤버십 가격 | 15px / 700 |
| 절약·공개 문구 | 11px / 500. 가입 시 ○원 절약 / 멤버십 회원에게 가격 공개 |
| 일부 품절 | 11px / 500, 회색 테두리 3px 라운드 |
| 이미지 배지 | 11px / 500 흰 글자, pink-deep, 패딩 2px 8px, 4px 라운드. 시계 아이콘 + "멤버십 특가 · HH:MM:SS" |

- 라이브 주황(`#FFA500`) 라벨·가격 → purple-deep, 배지 빨강(`#F54527`) → pink-deep
- **멤버십 특가 배지는 타임세일에 걸린 상품이므로 어느 섹션에 나오든 남은 시간이 함께 붙는다**(1초마다 갱신)
- 회원으로 보면: 정가 취소선 + 멤버십 가격(purple-deep) + "멤버십할인가 적용 / 멤버십 특가 적용". 회원 전용 타임세일 가격은 `sale-products.ts` 의 회원 판별 규칙을 그대로 따른다

## 6. 자산

- 카테고리 아이콘(`almondyoung-public` S3 `storefront/category-icons/*.png`)이 옛 주황이다. 새 색 버전이 필요하다. 시안은 스크립트로 재채색했다: 속눈썹펌·네일·헤어·샵매매 mint, 속눈썹연장·타투·왁싱 pink, 반영구·피부미용·샵간편식 purple, 노몬드 ink. 디자이너 원본으로 다시 받거나 같은 규칙으로 재채색해 올리고 `CATEGORY_ICON_VERSION` 을 올린다
- 로고: 흰 헤더용 `almondyoung-logo-on-light.png`
- 서비스 줄·모바일 퀵링크의 아몬드영 플레이 아이콘은 라이브 것을 그대로 쓴다: `storefront/quick-links/amdp-logo-white.png`(흰 워드마크) + 바탕 `#4f4a44`. 가로로 긴 로고라 서비스 줄에서는 칸을 48×20 으로 넓힌다
- 모바일 배너 원본이 780×360 이라 3배 해상도 폰에서 흐리다. 새 배너는 1560×720 으로 만든다

## 7. 구현 1단계: 디자인 토큰 교체

**구현을 시작하면 디자인 토큰이 바뀐다.** 이 문서를 쓴 시점(2026-11-06)에는 아직 바뀌지 않았다. `globals.css` 의 `--primary` 는 `#ffa500` 이고 `DESIGN.md` 도 주황 기준이다. 메인 화면 작업보다 먼저 이 단계를 따로 끝낸다. 토큰이 바뀌면 메인뿐 아니라 상품 상세·장바구니·결제·마이페이지까지 주요 버튼과 강조색이 함께 바뀌기 때문이다.

순서:

1. `src/styles/globals.css`: 1-1 표대로 값을 바꾸고 mint/pink/purple 토큰 9개를 더한다(라이트·다크 둘 다). Tailwind v4 `@theme` 에 `--color-mint` 등을 등록해 `bg-mint`·`text-mint-deep` 유틸이 생기게 한다
2. `DESIGN.md`: 1장 원칙과 2장 컬러 표를 1장 역할 표로 바꾼다. 4장 컴포넌트 규격의 Primary CTA 색(`#FFA500`, pressed `#e69500`)을 ink 기준으로 고친다. `web/almondyoung-storefront/CLAUDE.md` 의 디자인 시스템 요약(지금 `#ff6600` 으로 적혀 있어 실제 토큰 `#ffa500` 과도 이미 다르다)도 같이 고친다
3. 강조용 `text-primary` 옮기기: 값이 검정이 되면 강조가 사라지는 곳을 역할별로 옮긴다
   - 활성 탭·선택 상태·링크 → `text-mint-deep`
   - 멤버십 가격·라벨 → `text-purple-deep`
   - 할인율·타임세일 → `text-pink-deep`
   - 대상 파일 목록: `grep -rln "text-primary" src`
   - 면·테두리 쪽도 같이 본다: `grep -rlnE "bg-primary|border-primary|ring-primary|fill-primary|stroke-primary" src`. 버튼 면(`bg-primary`)은 검정이 맞으니 대부분 그대로 둔다
4. 하드코딩된 주황 지우기: 토큰을 거치지 않은 주황이 남아 있다. `grep -rnE "#ffa500|#FFA500|#ff6600|#f29219" src` 로 찾아 역할 토큰으로 바꾼다(예: 상품 카드 가격 `product-card/price.tsx`, 홈 리포트 `home/components/report/*`)
5. 확인: 홈·상품 상세·장바구니·결제·마이페이지·멤버십 구독 화면을 PC·모바일로 열어 주황이 남은 곳과 강조가 사라진 곳을 본다

이 단계는 화면 구조를 바꾸지 않는다. 색만 바뀐 상태로 한 번 배포할 수 있어야 한다.

## 8. 구현 전에 정할 것

1. ~~`DESIGN.md` 원칙 변경(한 색 → 역할별 색) 합의~~ → 합의, 토큰 교체 브랜치 `feat/storefront-rebrand-tokens` 에서 반영
2. ~~상단 공지 띠 데이터 모델과 관리자 화면~~ → 3장 (2026-11-06 결정)
3. ~~멤버십관 대상 상품 정의와 조회 방식~~ → 4-1·4-2 (2026-11-06 결정)
4. ~~타임세일 탭(전체/분야) 분류 기준~~ → 이미 있다. `src/lib/utils/time-sale-tabs.ts` 의 `deriveTimeSaleTabs` 가 상품의 카테고리로 루트 분야 탭을 만들고 빈 탭은 숨긴다. 그대로 쓴다. 멤버십관 분야 칩(4-2)도 이 함수를 재사용한다
5. ~~머신 회원가·샵 소모품 블록의 상품 선정 기준~~ → 다른 진열 블록(`showcase-categories/index.tsx`)처럼 카테고리 handle 을 하나씩 고정한다(2026-11-06 결정). 머신 블록은 그 카테고리에서 멤버십가 < 판매가인 상품을 절약액 큰 순으로 4개, 소모품 블록은 판매량순 6개. 운영자는 상품을 그 카테고리에 넣기만 한다. 어느 handle 인지는 구현 때 운영자에게 받는다
6. ~~브랜드관 상품 3개 정렬 기준~~ → 판매량순(2026-11-06 결정). 2-4 참고
