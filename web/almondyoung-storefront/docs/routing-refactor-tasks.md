# Routing Refactoring Tasks

_작업 범위: payment, membership 라우팅 재설계_  
_원칙: 복붙 → 네이밍 변경 → 링크 수정 → 커밋_

---

## 📦 Task 1: 결제수단 관리 경로 이관

**목표**: `/mypage/payment` → `/mypage/payment-methods`

### 작업 내용

1. **새 폴더 생성**

   ```bash
   mkdir -p src/app/[countryCode]/mypage/(subpages)/payment-methods
   mkdir -p src/app/[countryCode]/mypage/(subpages)/payment-methods/add/card
   mkdir -p src/app/[countryCode]/mypage/(subpages)/payment-methods/add/bank
   mkdir -p src/app/[countryCode]/mypage/(subpages)/payment-methods/verify
   ```

2. **파일 복사**

   ```bash
   # 관리 메인
   cp src/app/[countryCode]/mypage/(subpages)/payment/manage/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/page.tsx

   # components가 있다면 함께 복사
   cp -r src/app/[countryCode]/mypage/(subpages)/payment/manage/components.tsx \
         src/app/[countryCode]/mypage/(subpages)/payment-methods/ 2>/dev/null || true

   # 등록 선택 화면
   cp src/app/[countryCode]/mypage/(subpages)/payment/register/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/add/page.tsx

   # 카드 등록
   cp src/app/[countryCode]/mypage/(subpages)/payment/form/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/add/card/page.tsx

   cp src/app/[countryCode]/mypage/(subpages)/payment/form/*.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/add/card/ 2>/dev/null || true

   # 본인인증
   cp src/app/[countryCode]/mypage/(subpages)/payment/phone/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/verify/page.tsx

   # 계좌 등록 (card 복사해서 수정)
   cp src/app/[countryCode]/mypage/(subpages)/payment-methods/add/card/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/payment-methods/add/bank/page.tsx
   ```

3. **내부 링크 수정**
   - `payment-methods/page.tsx`: 등록 버튼 → `/payment-methods/add`
   - `payment-methods/add/page.tsx`: 카드/계좌 버튼 → `/add/card`, `/add/bank`
   - `payment-methods/add/card/page.tsx`: 인증 버튼 → `/verify`
   - `payment-methods/verify/page.tsx`: 완료 후 → `/payment-methods`

4. **마이페이지 메뉴 수정**
   - 파일: `src/app/[countryCode]/mypage/components/mobile/menu-list.tsx` (또는 해당 네비게이션 컴포넌트)
   - 수정: "결제수단 관리" 링크 → `/mypage/payment-methods`

### 완료 조건

- [ ] 모든 파일이 새 경로에 정상 복사됨
- [ ] `/kr/mypage/payment-methods` 접속 시 페이지 표시
- [ ] "+ 결제수단 등록" 버튼 → `/add` 이동
- [ ] "카드" 버튼 → `/add/card` 이동
- [ ] "본인인증" 버튼 → `/verify` 이동
- [ ] 콘솔 에러 없음

### 커밋 메시지

```
refactor: payment → payment-methods 경로 이관

- /mypage/payment/manage → /payment-methods
- /payment/register → /payment-methods/add
- /payment/form → /payment-methods/add/card
- /payment/phone → /payment-methods/verify
- 내부 링크 업데이트
```

---

## 📦 Task 2: 멤버십 구독 플로우 구축

**목표**: `membership/subscribe/` 경로 생성 및 기존 페이지 이동

### 작업 내용

1. **새 폴더 생성**

   ```bash
   mkdir -p src/app/[countryCode]/mypage/(subpages)/membership/subscribe/payment
   mkdir -p src/app/[countryCode]/mypage/(subpages)/membership/subscribe/success
   mkdir -p src/app/[countryCode]/mypage/(subpages)/membership/subscribe/fail
   ```

2. **플랜 선택 페이지 생성** (신규)

   ```bash
   # 기존 membership/page.tsx를 참고하여 단순화된 플랜 선택 UI 생성
   touch src/app/[countryCode]/mypage/(subpages)/membership/subscribe/page.tsx
   ```

   **내용**:

   ```tsx
   "use client"
   import { useRouter } from "next/navigation"

   export default function SubscribePage() {
     const router = useRouter()

     return (
       <div className="p-4">
         <h1 className="mb-6 text-2xl font-bold">플랜 선택</h1>

         {/* Pro 연간 */}
         <div className="mb-4 rounded-lg border p-4">
           <h2 className="font-bold">Pro 연간</h2>
           <p>189,000원 / 12개월 (21% 할인)</p>
           <button
             onClick={() =>
               router.push("/kr/mypage/membership/subscribe/payment")
             }
             className="mt-2 rounded bg-amber-500 px-4 py-2 text-white"
           >
             선택하기
           </button>
         </div>

         {/* Pro 월간 */}
         <div className="rounded-lg border p-4">
           <h2 className="font-bold">Pro 월간</h2>
           <p>19,000원 / 월</p>
           <button
             onClick={() =>
               router.push("/kr/mypage/membership/subscribe/payment")
             }
             className="mt-2 rounded bg-amber-500 px-4 py-2 text-white"
           >
             선택하기
           </button>
         </div>
       </div>
     )
   }
   ```

3. **결제수단 선택 페이지 생성**

   ```bash
   touch src/app/[countryCode]/mypage/(subpages)/membership/subscribe/payment/page.tsx
   ```

   **내용**:

   ```tsx
   "use client"
   import { useRouter } from "next/navigation"

   export default function SubscribePaymentPage() {
     const router = useRouter()

     // 임시: 항상 성공으로 (비즈니스 로직은 추후)
     const handlePayment = () => {
       router.push("/kr/mypage/membership/subscribe/success")
     }

     return (
       <div className="p-4">
         <h1 className="mb-4 text-xl font-bold">결제수단 선택</h1>
         <p className="mb-4">멤버십 결제는 카드만 가능합니다.</p>

         {/* 기존 카드 목록 (임시 UI) */}
         <div className="mb-4 rounded border p-4">
           <p>하나 BC카드</p>
           <p className="text-sm">****-****-****-1234</p>
         </div>

         <button
           onClick={handlePayment}
           className="w-full rounded bg-amber-500 py-3 text-white"
         >
           결제하기
         </button>
       </div>
     )
   }
   ```

4. **success/fail 페이지 이동**

   ```bash
   # 기존 파일 이동
   mv src/app/[countryCode]/mypage/(subpages)/membership/success/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/membership/subscribe/success/page.tsx

   mv src/app/[countryCode]/mypage/(subpages)/membership/fail/page.tsx \
      src/app/[countryCode]/mypage/(subpages)/membership/subscribe/fail/page.tsx
   ```

5. **내부 링크 수정**
   - `membership/page.tsx`: "멤버십 신청하기" 버튼 → `/membership/subscribe`
   - `subscribe/page.tsx`: 플랜 선택 → `/subscribe/payment`
   - `subscribe/payment/page.tsx`: 결제 완료 → `/subscribe/success`
   - `subscribe/success/page.tsx`: "쇼핑 계속하기" → `/` (홈)
   - `subscribe/fail/page.tsx`: "재시도" → `/membership/subscribe`

### 완료 조건

- [ ] `/kr/mypage/membership/subscribe` 플랜 선택 표시
- [ ] 플랜 선택 → `/subscribe/payment` 이동
- [ ] 결제 버튼 → `/subscribe/success` 이동
- [ ] 성공 페이지 표시 정상
- [ ] 콘솔 에러 없음

### 커밋 메시지

```
feat: 멤버십 구독 플로우 구축

- /membership/subscribe 플랜 선택 페이지 생성
- /subscribe/payment 결제수단 선택 페이지 생성
- success/fail 페이지 subscribe 하위로 이동
- 내부 링크 업데이트
```

---

## 📦 Task 3: 멤버십 회비 결제수단 관리 이름 변경

**목표**: `fee-method` → `payment-method`

### 작업 내용

1. **폴더명 변경**

   ```bash
   mv src/app/[countryCode]/mypage/(subpages)/membership/fee-method \
      src/app/[countryCode]/mypage/(subpages)/membership/payment-method
   ```

2. **내부 링크 수정**
   - `membership/page.tsx`: 회비 결제수단 링크 → `/membership/payment-method`
   - 기타 참조하는 곳 검색 후 수정

### 완료 조건

- [ ] `/kr/mypage/membership/payment-method` 접속 정상
- [ ] 기존 기능 동작 확인
- [ ] 콘솔 에러 없음

### 커밋 메시지

```
refactor: fee-method → payment-method 이름 변경

- 폴더명 변경
- 내부 링크 업데이트
```

---

## 📦 Task 4: 불필요한 파일 삭제 및 리다이렉트 설정

**목표**: 레거시 정리 + 리다이렉트

### 작업 내용

1. **레거시 폴더 삭제**

   ```bash
   # payment 폴더 전체 삭제 (새 payment-methods로 대체됨)
   rm -rf src/app/[countryCode]/mypage/(subpages)/payment

   # test 폴더 삭제
   rm -rf src/app/[countryCode]/mypage/(subpages)/membership/test

   # 기존 success/fail 빈 폴더 삭제 (subscribe로 이동했으므로)
   rm -rf src/app/[countryCode]/mypage/(subpages)/membership/success
   rm -rf src/app/[countryCode]/mypage/(subpages)/membership/fail
   ```

2. **next.config.js에 리다이렉트 추가**
   - 위 "5️⃣ 리다이렉트 설정" 섹션의 코드 추가

3. **로컬 테스트**
   - 기존 URL 접속 시 새 URL로 리다이렉트 확인
   - 예: `/kr/mypage/payment/manage` → `/kr/mypage/payment-methods`

### 완료 조건

- [ ] payment 폴더 삭제됨
- [ ] test 폴더 삭제됨
- [ ] 리다이렉트 동작 확인 (기존 URL → 새 URL)
- [ ] 빌드 에러 없음

### 커밋 메시지

```
chore: 레거시 폴더 삭제 및 리다이렉트 설정

- payment 폴더 삭제 (payment-methods로 대체)
- membership/test 폴더 삭제
- next.config.js 리다이렉트 추가
```

---

## 📦 Task 5: 전체 플로우 테스트 및 문서 업데이트

**목표**: 모든 경로 동작 확인 + 문서 갱신

### 작업 내용

1. **수동 플로우 테스트**
   - [ ] 마이페이지 메뉴에서 "결제수단 관리" 클릭 → `/payment-methods`
   - [ ] "+ 결제수단 등록" → `/add` → "카드" 선택 → `/add/card`
   - [ ] 본인인증 버튼 → `/verify` → 완료 후 `/payment-methods`
   - [ ] 마이페이지 메뉴에서 "멤버십 관리" 클릭 → `/membership`
   - [ ] "멤버십 신청하기" → `/subscribe` → 플랜 선택 → `/subscribe/payment`
   - [ ] 결제 진행 → `/subscribe/success`
   - [ ] "쇼핑 계속하기" → 홈으로

2. **리다이렉트 테스트**
   - [ ] `/kr/mypage/payment/manage` → `/payment-methods` 자동 이동
   - [ ] `/kr/mypage/membership/fee-method` → `/payment-method` 자동 이동

3. **콘솔 에러 확인**
   - [ ] 브라우저 콘솔에 에러 없음
   - [ ] 404 에러 없음

4. **README 업데이트** (선택)
   - 새 라우팅 구조를 README에 반영

### 완료 조건

- [ ] 모든 플로우 정상 동작
- [ ] 리다이렉트 정상 동작
- [ ] 콘솔/빌드 에러 없음

### 커밋 메시지

```
test: 전체 라우팅 플로우 테스트 완료

- payment-methods 플로우 검증
- membership subscribe 플로우 검증
- 리다이렉트 동작 확인
```

---

## ✅ 작업 완료 체크리스트

### 전체 완료 조건

- [ ] Task 1: 결제수단 관리 경로 이관 ✅
- [ ] Task 2: 멤버십 구독 플로우 구축 ✅
- [ ] Task 3: 회비 결제수단 이름 변경 ✅
- [ ] Task 4: 레거시 삭제 및 리다이렉트 ✅
- [ ] Task 5: 전체 테스트 ✅

### 최종 확인

- [ ] `yarn build` 성공
- [ ] 모든 경로 접속 가능
- [ ] UI 디자인 변경 없음 (기존과 동일)
- [ ] 각 task마다 커밋됨 (총 5개 커밋)

---

## 📝 참고사항

### 트러블슈팅

- **404 에러**: 파일 경로 오타 확인, `page.tsx` 파일명 확인
- **리다이렉트 안 됨**: `next.config.js` 저장 후 서버 재시작
- **링크 깨짐**: 모든 `<Link href>` 속성에 `/kr/mypage` 프리픽스 확인

### 롤백 방법

각 task 단위로 커밋했으므로, 문제 발생 시 해당 커밋으로 revert:

```bash
git revert <commit-hash>
```

---

**작업 시작 전 브랜치 생성 권장**:

```bash
git checkout -b refactor/routing-payment-membership
```

작업 완료 후 PR 생성!
