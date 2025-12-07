# PIM API 엔드포인트 목록

이 문서는 PIM 서비스의 모든 API 엔드포인트를 정리한 것입니다. 각 엔드포인트의 이름과 간단한 설명만 포함합니다.

## 1. Categories (카테고리 관리)
**Base Path:** `/categories`

| Method | Path | Name |
|--------|------|------|
| POST | `/categories` | 카테고리 생성 |
| PUT | `/categories/:id` | 카테고리 수정 |
| DELETE | `/categories/:id` | 카테고리 삭제 |
| GET | `/categories/:id` | 카테고리 상세 조회 |
| GET | `/categories` | 카테고리 트리 조회 |
| GET | `/categories/:id/children` | 하위 카테고리 조회 |
| GET | `/categories/:id/path` | 카테고리 경로 조회 |
| PUT | `/categories/:id/move` | 카테고리 이동 |
| PUT | `/categories/:id/products` | 상품들을 카테고리로 이동 |
| POST | `/categories/:id/products/add` | 상품들을 카테고리에 추가 |
| PATCH | `/categories/:id/display-settings` | 카테고리 표시 설정 업데이트 |
| PATCH | `/categories/:id/seo` | 카테고리 SEO 설정 업데이트 |
| PATCH | `/categories/:id/template` | 카테고리 템플릿 설정 업데이트 |
| PATCH | `/categories/:id/visibility` | 카테고리 표시 여부 업데이트 |
| PUT | `/categories/:categoryId/tag-groups` | 카테고리 태그 그룹 연결 설정 |
| GET | `/categories/:categoryId/tag-groups` | 카테고리 태그 그룹 조회 |

## 2. Product Masters (제품 마스터)
**Base Path:** `/masters`

| Method | Path | Name |
|--------|------|------|
| POST | `/masters` | 제품 마스터 생성 |
| GET | `/masters` | 상품 목록 조회 |
| GET | `/masters/deleted` | 삭제된 제품 마스터 목록 조회 |
| GET | `/masters/:id` | 제품 마스터 상세 조회 (Active 버전) |
| DELETE | `/masters/:masterId` | 제품 마스터 소프트 삭제 |
| POST | `/masters/:masterId/restore` | 제품 마스터 복원 |
| PATCH | `/masters/:masterId/unpublish` | 제품 마스터 비공개 처리 |
| DELETE | `/masters/:id/permanent` | 제품 버전 영구 삭제 |

## 3. Product Versions (제품 버전 관리)
**Base Path:** `/masters/:masterId/versions`

| Method | Path | Name |
|--------|------|------|
| GET | `/masters/:masterId/versions` | 버전 트리 조회 |
| GET | `/masters/:masterId/versions/active` | Active 버전 조회 |
| GET | `/masters/:masterId/versions/:versionId` | 특정 버전 조회 |
| POST | `/masters/:masterId/versions` | 새 Draft 버전 생성 |
| PUT | `/masters/:masterId/versions/:versionId` | Draft 버전 수정 |
| PATCH | `/masters/:masterId/versions/:versionId/publish` | 버전 Publish |
| GET | `/masters/:masterId/versions/:versionId/compare/:compareVersionId` | 버전 비교 |
| DELETE | `/masters/:masterId/versions/:versionId` | Draft 버전 삭제 |

## 4. Product Variants (제품 변형)
**Base Path:** `/variants`

| Method | Path | Name |
|--------|------|------|
| GET | `/variants/masters/:masterId` | 마스터별 제품 변형 조회 |
| GET | `/variants/masters/:masterId/versions/:versionId` | 버전별 제품 변형 조회 |
| GET | `/variants/:id` | 제품 변형 상세 조회 |
| PUT | `/variants/:id` | 제품 변형 수정 |
| PUT | `/variants/bulk` | 제품 변형 일괄 수정 |
| GET | `/variants/:id/price` | 제품 변형 가격 조회 (Deprecated) |
| PUT | `/variants/:id/status` | 제품 변형 상태 수정 |

## 5. Sales Channels (판매 채널)
**Base Path:** `/channels`

| Method | Path | Name |
|--------|------|------|
| POST | `/channels` | 판매 채널 생성 |
| GET | `/channels` | 판매 채널 목록 조회 |
| GET | `/channels/active` | 활성 판매 채널 조회 |
| GET | `/channels/:id` | 판매 채널 상세 조회 |
| PUT | `/channels/:id` | 판매 채널 수정 |
| DELETE | `/channels/:id` | 판매 채널 삭제 |
| PUT | `/channels/:id/status` | 판매 채널 상태 설정 |
| GET | `/channels/type/:type` | 타입별 판매 채널 조회 |
| POST | `/channels/validate` | 판매 채널 설정 검증 |

## 6. Channel Categories (판매처 분류)
**Base Path:** `/channels/categories`

| Method | Path | Name |
|--------|------|------|
| GET | `/channels/categories` | 판매처 분류 목록 조회 |
| GET | `/channels/categories/:id` | 판매처 분류 상세 조회 |
| POST | `/channels/categories` | 판매처 분류 생성 |
| PUT | `/channels/categories/:id` | 판매처 분류 수정 |
| DELETE | `/channels/categories/:id` | 판매처 분류 삭제 |

## 7. Channel Products (채널별 제품)
**Base Path:** `/channel-products`

| Method | Path | Name |
|--------|------|------|
| POST | `/channel-products` | 채널별 제품 생성 |
| GET | `/channel-products/masters/:masterId` | 마스터별 채널 제품 조회 |
| GET | `/channel-products/channels/:channelId` | 채널별 제품 조회 |
| GET | `/channel-products/:id` | 채널 제품 상세 조회 |
| PUT | `/channel-products/:id` | 채널 제품 수정 |
| DELETE | `/channel-products/:id` | 채널 제품 삭제 |
| GET | `/channel-products/masters/:masterId/channels/:channelId/merged` | 병합된 채널 제품 조회 |
| PUT | `/channel-products/:id/name` | 제품명 덤어쓰기 |
| PUT | `/channel-products/:id/status` | 채널 제품 상태 설정 |

## 8. Channel Listings (채널 상품 매핑)
**Base Path:** `/channel-listings`

| Method | Path | Name |
|--------|------|------|
| GET | `/channel-listings/lookup` | 채널 상품 ID로 Variant 조회 |
| POST | `/channel-listings` | 채널 매핑 생성 |
| GET | `/channel-listings/by-variant/:variantId` | Variant의 채널 등록 현황 조회 |
| GET | `/channel-listings/:id` | 채널 매핑 상세 조회 |
| PUT | `/channel-listings/:id` | 채널 매핑 수정 |
| PUT | `/channel-listings/:id/deactivate` | 채널 매핑 비활성화 |
| PUT | `/channel-listings/:id/activate` | 채널 매핑 활성화 |
| DELETE | `/channel-listings/:id` | 채널 매핑 삭제 |

## 9. Pricing (가격 관리)
**Base Path:** `/products/:masterId/pricing`

| Method | Path | Name |
|--------|------|------|
| GET | `/products/:masterId/pricing/rules` | 가격 규칙 조회 |
| PUT | `/products/:masterId/pricing/rules` | 가격 규칙 교체 |
| DELETE | `/products/:masterId/pricing/rules` | 가격 규칙 삭제 |
| POST | `/products/:masterId/pricing/calculate` | Variant 가격 계산 |
| GET | `/products/:masterId/pricing/price-set` | Variant 전체 가격 세트 조회 |

## 10. Tags (태그 관리)
**Base Path:** `/tags`

### Tag Groups
| Method | Path | Name |
|--------|------|------|
| POST | `/tags/groups` | 태그 그룹 생성 |
| GET | `/tags/groups` | 태그 그룹 목록 조회 |
| GET | `/tags/groups/:id` | 태그 그룹 단일 조회 |
| GET | `/tags/groups/:id/detail` | 태그 그룹 상세 조회 (값 포함) |
| PUT | `/tags/groups/:id` | 태그 그룹 수정 |
| DELETE | `/tags/groups/:id` | 태그 그룹 삭제 |

### Tag Values
| Method | Path | Name |
|--------|------|------|
| POST | `/tags/groups/:groupId/values` | 태그 값 생성 |
| GET | `/tags/groups/:groupId/values` | 태그 값 목록 조회 |
| GET | `/tags/values/:id` | 태그 값 단일 조회 |
| PUT | `/tags/values/:id` | 태그 값 수정 |
| DELETE | `/tags/values/:id` | 태그 값 삭제 |

## 11. Banners (배너 관리)
**Base Path:** `/banners`, `/banner-groups`

### Banners
| Method | Path | Name |
|--------|------|------|
| POST | `/banners` | 배너 생성 |
| GET | `/banners/by-group/:bannerGroupId` | 배너 그룹의 배너 목록 조회 |
| GET | `/banners/:id` | 배너 상세 조회 |
| PUT | `/banners/:id` | 배너 수정 |
| DELETE | `/banners/:id` | 배너 삭제 (Soft Delete) |

### Banner Groups
| Method | Path | Name |
|--------|------|------|
| POST | `/banner-groups` | 배너 그룹 생성 |
| GET | `/banner-groups` | 배너 그룹 목록 조회 |
| GET | `/banner-groups/by-code/:code` | 배너 그룹 조회 (코드) |
| GET | `/banner-groups/:id` | 배너 그룹 상세 조회 (ID) |
| PUT | `/banner-groups/:id` | 배너 그룹 수정 |
| DELETE | `/banner-groups/:id` | 배너 그룹 삭제 (Soft Delete) |

## 12. Product Search (제품 검색)
**Base Path:** `/products/search`

| Method | Path | Name |
|--------|------|------|
| GET | `/products/search` | Elasticsearch를 이용한 제품 검색 |

## 13. Dashboard (대시보드)
**Base Path:** `/dashboard`

| Method | Path | Name |
|--------|------|------|
| GET | `/dashboard/metrics` | 대시보드 메트릭 조회 |
| GET | `/dashboard/top-products` | 상위 제품 목록 조회 |
| GET | `/dashboard/sales-trends` | 매출 트렌드 조회 |

## 14. Product Approval (제품 승인)
**Base Path:** `/masters`

| Method | Path | Name |
|--------|------|------|
| POST | `/masters/:id/submit-approval` | 제품 승인 요청 |
| POST | `/masters/:id/approve` | 제품 승인 |
| POST | `/masters/:id/reject` | 제품 거부 |
| GET | `/masters/pending-approval` | 승인 대기 중인 제품 목록 |
| GET | `/masters/:id/approval-history` | 제품 승인 이력 |

## 15. Product CSV (CSV 임포트/엑스포트)
**Base Path:** `/products/csv`

| Method | Path | Name |
|--------|------|------|
| GET | `/products/csv/template` | CSV 템플릿 다운로드 |
| POST | `/products/csv/bulk-import` | CSV 파일로 제품 일괄 등록 |
| GET | `/products/csv/export` | 제품 목록 CSV 내보내기 |

## 16. Product Bulk Operations (제품 일괄 작업)
**Base Path:** `/masters/bulk`

| Method | Path | Name |
|--------|------|------|
| POST | `/masters/bulk/update` | 제품 일괄 수정 |
| POST | `/masters/bulk/delete` | 제품 일괄 소프트 삭제 |
| POST | `/masters/bulk/restore` | 제품 일괄 복원 |

## 17. Product Audit (제품 감사)
**Base Path:** `/products/audit`

| Method | Path | Name |
|--------|------|------|
| GET | `/products/audit/:id` | 제품 감사 이력 조회 |
| GET | `/products/audit/recent` | 최근 감사 로그 조회 |
| GET | `/products/audit/by-user/:userId` | 사용자별 감사 로그 조회 |
| GET | `/products/audit/by-action/:action` | 액션별 감사 로그 조회 |

---

## 요약 통계

- **총 컨트롤러 수**: 17개
- **총 엔드포인트 수**: 100개 이상
- **주요 기능 영역**:
  - 상품 정보 관리 (Masters, Versions, Variants)
  - 카테고리 관리
  - 판매 채널 관리
  - 가격 관리
  - 태그 관리
  - 배너 관리
  - 검색 및 대시보드
  - 승인 워크플로우
  - CSV 임포트/엑스포트
  - 일괄 작업
  - 감사 로그
