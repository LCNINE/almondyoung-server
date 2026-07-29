# feature/admin-web → develop 머지 런북

상품 목록 필터를 피그마 디자인(grid 헤더형 검색 패널)으로 교체하고, 등록자·공급처 필터를
추가한 작업의 머지·배포 절차. 2026-07-29 기준.

---

## 1. 이 브랜치가 바꾼 것

| 영역 | 변경 |
|---|---|
| 상품 목록 필터 | `필터 추가` 드롭다운 + 업무 큐 버튼 → **grid 헤더형 검색 패널**(일자/선택사항/분류/검색항목 + 하단 검색 버튼) |
| 재고 상태 | 품절·부분품절을 **분류 버튼 그룹에 통합** (기존 업무 큐 흡수) |
| 등록자 필터 | 신규 — `product_masters.created_by` 기준 |
| 공급처 필터 | 신규 — `product_master_versions.supplier_id` 기준 |
| 상품 수정 화면 | **공급처 선택** 입력칸 추가 (기본정보 탭, 브랜드 아래) |
| 카테고리 표기 | 경로 구분자 `/` → `>` (`속눈썹펌 > 펌제`) |
| `FormSelect` | 드롭다운이 뷰포트를 덮던 문제 수정 (`position="popper"` + `max-h-72`) |

새로 만든 공통 컴포넌트: `components/common/form/search-filter-panel.tsx`
(`SearchFilterPanel` + `FilterRow`).

---

## 2. 스키마 변경이 **없다**

이 브랜치는 drizzle 마이그레이션을 **하나도 만들지 않는다.**

```
apps/*/drizzle/  변경 0건
```

- `created_by`, `supplier_id` 모두 **이미 존재하던 컬럼**이다. 읽고 쓰기만 한다.
- 따라서 `db:migrate` 는 **부르지 않는다.**
- 평소의 "배포 = deploy + migrate 세트" 규칙([[project_live_manual_deploy_migrate_trap]])이
  이번엔 적용되지 않는다. deploy 만 하면 된다.

> 작업 도중 `country_of_origin`(원산지) 컬럼을 추가했다가 되돌린 이력이 있다.
> 셀메이트의 "원산지"로 보였던 값이 사실은 **공급처**였고, Core 에 이미
> `suppliers` 테이블과 `supplier_id` 컬럼이 있었기 때문이다. 마이그레이션 파일과
> journal 까지 전부 롤백했으므로 흔적은 남아 있지 않다.

---

## 3. 배포

Core 를 **먼저** 올린다. admin 이 먼저 뜨면 `createdBy`/`supplierId` 파라미터를
옛 Core 가 무시해서 필터가 조용히 안 걸린다.

```bash
cd deployments/lcnine/services
nvm use 20.20.1                    # Node 25 면 Next.js 빌드가 깨진다
npx sst deploy --stage live --target Core --target AdminWeb
```

- `AdminWeb` 은 Next.js 빌드라 무겁다. 다른 컴포넌트는 **절대 포함시키지 말 것.**
- Medusa·Storefront 등은 이 브랜치와 무관하다.

---

## 4. 배포 후: 공급처 백필 (라이브 1회)

공급처 값은 셀메이트에만 있다. Core 는 전부 비어 있으므로 백필해야 필터가 의미를 가진다.

### 4-1. 셀메이트 CSV 받기

셀메이트 > **상품관리 > 상품목록** 에서 엑셀 다운로드.
(재고 목록이 아니다 — 재고 목록엔 공급처 컬럼이 없다.)
cp949 인코딩 47컬럼 CSV 이며 `공급처` 컬럼이 있어야 한다.

### 4-2. 터널 열고 실행

```bash
# 터널 (services RDS 는 services 디렉터리에서)
cd deployments/lcnine/services
npx sst tunnel --stage live

# 백필
DATABASE_URL='postgresql://.../core' \
  ./scripts/backfill-supplier-from-sellmate.sh ~/Downloads/<셀메이트CSV>
```

스크립트가 하는 일:

1. 바코드를 숫자만 남겨 정규화 (`="123"`, `1-123` 표기 혼재)
2. `suppliers` 에 없는 공급처 이름만 INSERT
3. 바코드 → `sku_barcodes` → `product_variant_sku_links` → `product_matchings.master_id`
   경로로 상품을 찾아 그 상품의 **모든 버전**에 `supplier_id` 를 심는다

**멱등하다.** 두 번 돌리면 `INSERT 0 / UPDATE 0` 이 나온다.

`updated_at` 은 일부러 갱신하지 않는다 — 운영자의 상품 수정이 아니라 과거 데이터 정정이라,
'최근 수정' 정렬과 변경 이력을 오염시키면 안 된다.

### 4-3. 로컬 실행 결과 (참고 수치)

```
공급처 마스터  18종 등록
상품          8,962 / 10,654 (84%)
버전 행       8,969
```

붙지 않는 16% 는 셀메이트에 없거나 SKU 매칭이 아직 안 된 상품이다.
실제로 값이 붙은 공급처는 9종(한국 7,404 · 중국 1,085 · 한국 직배 273 · PermaBlend 93 ·
자체제작 89 · 중국 해외 직구 9 · 일본 7 · 케이영생산 1 · 베트남 1)이고,
나머지 9종은 마스터에만 등록돼 있다가 매칭이 붙으면 채워진다.

---

## 5. Medusa 는 영향받지 않는다

백필로 **Medusa 이벤트가 발행되지 않는다.** 이유 두 가지:

1. 백필은 SQL 직접 UPDATE 라 애플리케이션 계층을 아예 지나지 않는다.
2. 상품 이벤트는 `publishVersion`(active 버전 전환) 시점에만 발행된다
   (`_emitActiveVersionChangedEvent`, reason = `published`/`unpublished`/`rollback`).
   필드 수정만으로는 발행되지 않는다.

또한 `supplierId` 는 Medusa 로 나가는 `ProductSnapshot`(event-contracts)에 **없다.**
공급처는 내부 조달 정보이므로 판매채널 projection 에 싣지 않는다.

즉 8,962건을 백필해도 **Medusa 재발행 0건**이다.

---

## 6. 검증 체크리스트

배포 후 `admin.almondyoung.com/mall/products-list` 에서:

- [ ] 필터 패널이 4행(일자 / 선택사항 / 분류 / 검색항목)으로 뜬다
- [ ] 분류 버튼을 눌러도 **버튼 크기·위치가 흔들리지 않는다**
- [ ] `품절` → 검색 → URL 이 `?status=active&stock=sold_out`, 목록이 전부 품절 배지
- [ ] 새로고침해도 선택한 분류 버튼이 유지된다
- [ ] `초기화` → URL 파라미터가 전부 사라진다
- [ ] 분류(카테고리) 드롭다운이 `대분류 > 중분류` 로 뜨고, **화면을 덮지 않는다**
- [ ] 등록자 드롭다운에 `loginId (이름)` 형식으로 관리자가 뜬다
- [ ] 공급처 드롭다운에 18종이 뜨고, 고르면 결과가 걸러진다
- [ ] 상품 상세 > 기본정보에 **공급처 선택칸**이 있고 저장이 된다
- [ ] `/mall/bulk`(일괄 작업)이 정상 동작한다 ← 아래 함정 참고

---

## 7. 롤백

스키마 변경이 없으므로 **코드만 되돌리면 끝난다.** DB 되돌릴 것 없음.

백필까지 되돌리려면:

```sql
UPDATE product_master_versions SET supplier_id = NULL WHERE supplier_id IS NOT NULL;
-- 공급처 마스터까지 지우려면 (다른 데서 참조 없을 때만)
DELETE FROM suppliers WHERE name <> '기본';
```

---

## 8. 함정 (리뷰할 때 꼭 볼 것)

**① `/mall/bulk` 이 같은 훅을 공유한다.**
`use-products-list-table-query.ts` 와 `use-products-list-table-filters.ts` 를
일괄 작업 페이지가 그대로 쓴다. 상품 목록에서만 쓰는 줄 알고 지우면 그 페이지가 깨진다.
(작업 중 실제로 "죽은 파일"로 오판했다가 되돌린 적 있음.)

**② 카테고리 구분자 변경이 bulk 에도 적용된다.**
`toCategoryFilterOptions` 를 공유하므로 일괄 작업 페이지의 카테고리 라벨도 `>` 로 바뀐다.
의도한 부수효과이며, 두 화면 표기가 통일된다.

**③ `FormSelect` 변경은 13개 파일에 영향간다.**
`position="popper"` 로 바꿨기 때문에 드롭다운이 트리거 **아래**에 붙는다(기존 `item-aligned`
는 선택 항목을 트리거 위치에 맞췄다). 위치가 달라 보이는 건 정상이다.

**④ `DataTableFilter` 는 건드리지 않았다.**
나머지 25개 페이지(`filters={}` 를 넘기는 곳)는 무영향이다.

**⑤ `.gitignore` 가 `*.sql` 을 전부 무시한다.**
백필 SQL 을 별도 `.sql` 파일로 두면 레포에 안 남는다. 그래서 `.sh` 안에 heredoc 으로 넣었다.

**⑥ 원산지가 아니라 공급처다.**
피그마에는 "원산지 선택"으로 그려져 있지만 셀메이트 데이터 실체는 공급처다
(국가는 95%뿐이고 `자체제작`·`3PL 제품`·`PermaBlend` 같은 값이 섞여 있다).
디자인 문구와 다르더라도 **공급처**로 부른다.

---

## 9. 아직 안 된 것

- **`material`(재질) 컬럼은 여전히 방치 상태** — DB 컬럼은 있는데 수정 DTO 에도 없어서
  값을 넣을 방법이 없다. 이번 작업 범위 밖.
- 셀메이트 공급처 18종 중 9종은 아직 붙은 상품이 없다 (SKU 매칭 대기).
- 멤버십 회원 페이지(`features/membership/members/components/filter-box`)가 같은 모양의
  필터를 **자기 인라인 코드로** 갖고 있다. `SearchFilterPanel` 로 이관하면 중복이 사라진다.
