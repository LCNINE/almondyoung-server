# 관리자 재고 관리 권한 시스템

## 📋 개요

accessToken의 `scope` 필드를 확인하여 관리자 권한을 판별하고, 마이페이지에서 재고 관리 버튼을 표시하는 기능입니다.

## 🔐 권한 체계

### 1단계: accessToken의 scope 확인 (스토어프론트 로그인)

```typescript
// accessToken JWT payload
{
  "scope": "master",  // 또는 "admin", "MASTER", "ADMIN" (대소문자 구분 없음)
  "user_id": "...",
  // ...
}
```

**판별 로직**:
- `scope`가 `"master"` 또는 `"admin"`이면 관리자로 인정
- 대소문자 구분 없음 (`Master`, `ADMIN`, `AdMiN` 모두 OK)

### 2단계: medusaSigninAdmin 호출 (재고 관리 API 접근)

user-service에서 발급받은 accessToken을 사용하여 `medusaSigninAdmin()` 함수를 호출하면 `actor_type`이 `"user"`인 Medusa JWT를 받습니다.

```typescript
// _medusa_jwt payload (medusaSigninAdmin 이후)
{
  "actor_type": "user",  // customer가 아닌 user
  "actor_id": "...",
  // ...
}
```

## 🎨 UI 표시 로직

### 마이페이지 홈 화면

**조건**: `checkAdminScope()` 함수가 `isAdmin: true`를 반환하면 "재고 관리" 버튼 표시

**위치**:
- **데스크탑**: UserProfileSection 바로 아래
- **모바일**: MobileHeader 아래, SavingsBanner 위

**버튼 스타일**:
```tsx
<Button asChild variant="outline" size="sm">
  <Link href="/kr/mypage/admin/inventory">
    <Shield className="mr-2 h-4 w-4" />
    재고 관리
  </Link>
</Button>
```

## 📂 수정된 파일

### 1. `/src/lib/api/admin/inventory.ts`

```typescript
/**
 * accessToken의 scope를 확인하여 관리자 권한이 있는지 체크
 * scope가 "master" 또는 "admin"이면 관리자로 인정 (대소문자 구분 없음)
 */
export async function checkAdminScope(): Promise<{
  isAdmin: boolean
  scope?: string
}>

/**
 * Medusa JWT의 actor_type을 확인하여 관리자인지 체크
 * (기존 방식 - medusaSigninAdmin 이후 사용)
 */
export async function checkAdminAccess(): Promise<boolean>
```

**역할**:
- `checkAdminScope()`: 마이페이지에서 버튼 표시 여부 결정 (accessToken 기반)
- `checkAdminAccess()`: 재고 관리 API 호출 권한 확인 (Medusa JWT 기반)

### 2. `/src/components/admin/admin-access-button.tsx` (신규)

```tsx
/**
 * 관리자 접근 버튼
 * accessToken의 scope가 master 또는 admin인 경우에만 표시
 */
export function AdminAccessButton({ 
  countryCode, 
  className 
}: AdminAccessButtonProps)
```

### 3. `/src/domains/mypage/template/mypage-template.tsx`

```typescript
export async function MyPageTemplate() {
  const currentUser = await fetchMe()
  const { isAdmin } = await checkAdminScope()  // ✅ 추가

  // countryCode 추출
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  return (
    <>
      <MyPageMobileContent 
        currentUser={currentUser}
        isAdmin={isAdmin}          // ✅ 전달
        countryCode={countryCode}  // ✅ 전달
      />
      <MyPageDesktopContent 
        currentUser={currentUser}
        isAdmin={isAdmin}          // ✅ 전달
        countryCode={countryCode}  // ✅ 전달
      />
    </>
  )
}
```

### 4. `/src/domains/mypage/components/desktop/index.tsx`

```tsx
export function MyPageDesktopContent({
  currentUser,
  isAdmin = false,        // ✅ 추가
  countryCode = "kr",     // ✅ 추가
}: MyPageDesktopContentProps) {
  return (
    <div>
      <UserProfileSection ... />
      
      {/* 관리자 버튼 */}
      {isAdmin && (
        <div className="mb-4">
          <AdminAccessButton countryCode={countryCode} />
        </div>
      )}

      <QuickMenuSection />
      ...
    </div>
  )
}
```

### 5. `/src/domains/mypage/components/mobile/index.tsx`

```tsx
export function MyPageMobileContent({ 
  currentUser,
  isAdmin = false,        // ✅ 추가
  countryCode = "kr",     // ✅ 추가
}: MyPageMobileContentProps) {
  return (
    <div className="mx-auto">
      <div className="bg-muted space-y-4 px-6 py-4">
        <MobileHeader userName={currentUser?.username} />
        
        {/* 관리자 버튼 */}
        {isAdmin && (
          <div className="pb-2">
            <AdminAccessButton 
              countryCode={countryCode}
              className="w-full"
            />
          </div>
        )}

        <SavingsBanner />
        ...
      </div>
    </div>
  )
}
```

## 🧪 테스트 시나리오

### 시나리오 1: 일반 사용자

```
1. scope가 "customer" 또는 scope 없음
2. 마이페이지 접속
3. "재고 관리" 버튼 보이지 않음 ✅
```

### 시나리오 2: 관리자 (master)

```
1. scope가 "master" (대소문자 무관)
2. 마이페이지 접속
3. "재고 관리" 버튼 표시됨 ✅
4. 버튼 클릭 → /kr/mypage/admin/inventory 이동
5. medusaSigninAdmin() 호출되어야 함 (아직 미구현)
6. actor_type이 "user"가 되어야 재고 관리 페이지 접근 가능
```

### 시나리오 3: 관리자 (admin)

```
1. scope가 "admin" (대소문자 무관)
2. 시나리오 2와 동일 ✅
```

## 🔄 권한 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                     권한 체크 흐름                           │
└─────────────────────────────────────────────────────────────┘

1. 사용자 로그인
   ↓
2. user-service가 accessToken 발급
   - scope: "master" 또는 "admin"
   ↓
3. 스토어프론트 쿠키에 저장
   - Cookie: accessToken=...
   ↓
4. 마이페이지 접속
   ↓
5. checkAdminScope() 실행
   - accessToken 파싱
   - scope 확인 (대소문자 무관)
   - isAdmin: true/false 반환
   ↓
6-A. isAdmin === false
   - "재고 관리" 버튼 숨김
   - 끝
   
6-B. isAdmin === true
   - "재고 관리" 버튼 표시
   ↓
7. 사용자가 버튼 클릭
   ↓
8. /mypage/admin/inventory 페이지로 이동
   ↓
9. checkAdminAccess() 실행
   - _medusa_jwt 확인
   - actor_type === "user" 체크
   ↓
10-A. actor_type === "customer"
   - 권한 없음 화면 표시
   - medusaSigninAdmin() 호출 필요 (TODO)
   
10-B. actor_type === "user"
   - 재고 관리 페이지 표시
   - 셀메이트 엑셀 업로드 가능
```

## ⚠️ 남은 작업

### TODO: medusaSigninAdmin 자동 호출

현재 재고 관리 페이지(`/mypage/admin/inventory`)에서는 `checkAdminAccess()`가 `_medusa_jwt`의 `actor_type`만 확인합니다.

**문제**:
- 일반 로그인 시: `actor_type === "customer"`
- 관리자로 로그인했어도 `medusaSigninAdmin()`을 호출하지 않으면 `actor_type`이 `"user"`가 아님

**해결 방법 1**: 재고 관리 페이지에서 자동으로 `medusaSigninAdmin()` 호출

```typescript
// /src/app/[countryCode]/(mypage)/mypage/admin/inventory/page.tsx

export default async function AdminInventoryPage() {
  // 1. scope 확인
  const { isAdmin, scope } = await checkAdminScope()
  
  if (!isAdmin) {
    return <div>권한 없음</div>
  }

  // 2. actor_type 확인
  const hasAccess = await checkAdminAccess()
  
  // 3. actor_type이 "user"가 아니면 medusaSigninAdmin 호출
  if (!hasAccess) {
    await medusaSigninAdmin()
    revalidatePath('/mypage/admin/inventory')
  }

  // 4. 재고 관리 UI 표시
  return <InventoryManagementUI />
}
```

**해결 방법 2**: Middleware에서 자동 처리

```typescript
// /src/middleware.ts

export async function middleware(request: NextRequest) {
  // /mypage/admin/* 경로 접근 시
  if (request.nextUrl.pathname.includes('/mypage/admin')) {
    const { isAdmin } = await checkAdminScope()
    
    if (isAdmin) {
      const hasAccess = await checkAdminAccess()
      
      if (!hasAccess) {
        // medusaSigninAdmin 호출
        await medusaSigninAdmin()
      }
    }
  }
}
```

## 📊 대소문자 매칭 로직

```typescript
const scope = payload.scope.toLowerCase()
const isAdmin = scope === "master" || scope === "admin"
```

**테스트 케이스**:
- `"master"` → `true` ✅
- `"Master"` → `true` ✅
- `"MASTER"` → `true` ✅
- `"MaStEr"` → `true` ✅
- `"admin"` → `true` ✅
- `"Admin"` → `true` ✅
- `"ADMIN"` → `true` ✅
- `"AdMiN"` → `true` ✅
- `"customer"` → `false` ✅
- `"user"` → `false` ✅
- `undefined` → `false` ✅

## 🎨 UI 스크린샷 (예상)

### 데스크탑 - 일반 사용자
```
┌─────────────────────────────────────┐
│ 마이페이지                           │
├─────────────────────────────────────┤
│ 👤 홍길동님                          │
│                                     │
│ 📦 주문목록  ❤️ 찜한상품  🔁 자주산상품 │
│ ...                                 │
└─────────────────────────────────────┘
```

### 데스크탑 - 관리자
```
┌─────────────────────────────────────┐
│ 마이페이지                           │
├─────────────────────────────────────┤
│ 👤 관리자님                          │
│                                     │
│ ┌───────────────────────────────┐   │
│ │ 🛡️ 재고 관리                  │   │ ← 추가됨!
│ └───────────────────────────────┘   │
│                                     │
│ 📦 주문목록  ❤️ 찜한상품  🔁 자주산상품 │
│ ...                                 │
└─────────────────────────────────────┘
```

### 모바일 - 관리자
```
┌───────────────────┐
│ 마이페이지        │
├───────────────────┤
│ 👤 관리자님       │
│                   │
│ ┌───────────────┐ │
│ │🛡️ 재고 관리   │ │ ← 추가됨! (전체 너비)
│ └───────────────┘ │
│                   │
│ 💰 적립금         │
│ 🏷️ 쿠폰          │
│ ...               │
└───────────────────┘
```

## 🔗 관련 파일

- `src/lib/api/admin/inventory.ts` - 권한 체크 함수
- `src/components/admin/admin-access-button.tsx` - 관리자 버튼 컴포넌트
- `src/domains/mypage/template/mypage-template.tsx` - 마이페이지 템플릿
- `src/domains/mypage/components/desktop/index.tsx` - 데스크탑 레이아웃
- `src/domains/mypage/components/mobile/index.tsx` - 모바일 레이아웃
- `src/app/[countryCode]/(mypage)/mypage/admin/inventory/page.tsx` - 재고 관리 페이지

---

**작성일**: 2026-01-30  
**상태**: ✅ 완료 (medusaSigninAdmin 자동 호출은 TODO)

