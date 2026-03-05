# API 구조 비교

## PIM API

### 1. Channels (판매처 관리)

#### 판매처 목록 조회
- **URL**: `GET /api/pim/sales-channels`
- **쿼리 파라미터**: page, limit, siteId, search, isActive
- **응답 형식**:
```json
{
  "data": SalesChannel[],
  "total": number,
  "page": number,
  "limit": number,
  "totalPages": number
}
```

#### 판매처 사이트 목록 조회
- **URL**: `GET /api/pim/sales-channel-sites`
- **응답 형식**: SalesChannelSite[]

#### 판매처 생성
- **URL**: `POST /api/pim/sales-channels`
- **요청 본문**: CreateSalesChannelDto
- **응답**: SalesChannel

#### 판매처 수정
- **URL**: `PUT /api/pim/sales-channels/:id`
- **요청 본문**: UpdateSalesChannelDto
- **응답**: SalesChannel

#### 판매처 삭제
- **URL**: `DELETE /api/pim/sales-channels/:id`
- **응답**: 204 No Content

### 2. 기타 PIM 엔드포인트들
- Categories, Masters, Variants, Channel Products 등...

## 주요 특징

1. **일관된 응답 구조**: 모든 목록 API는 동일한 페이지네이션 구조 사용
2. **표준 HTTP 메서드**: GET, POST, PUT, DELETE 사용
3. **RESTful 설계**: 리소스 기반 URL 구조
4. **타입 안전성**: TypeScript 인터페이스로 모든 요청/응답 타입 정의
