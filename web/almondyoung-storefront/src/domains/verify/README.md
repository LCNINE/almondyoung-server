# Verification Components

이 디렉토리는 본인 인증 관련 컴포넌트들을 포함합니다.

## 컴포넌트 구조

### 1. Phone Verification (휴대폰 인증)
- `phone/index.tsx`: 휴대폰 인증 폼 컴포넌트
- `phone/phone-verify-drawer.tsx`: 휴대폰 인증 Drawer 래퍼

### 2. Business Verification (사업자 확인)
- `business/index.tsx`: 사업자 확인 폼 컴포넌트
- `business/business-verify-drawer.tsx`: 사업자 확인 Drawer 래퍼

## 사용 예시

### 독립적으로 휴대폰 인증만 사용하기

```tsx
import { PhoneVerifyDrawer } from "domains/verify/phone/phone-verify-drawer"

function MyComponent() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>
        본인 인증하기
      </button>
      
      <PhoneVerifyDrawer
        open={open}
        onOpenChange={setOpen}
        onComplete={() => {
          console.log("인증 완료!")
          setOpen(false)
        }}
      />
    </>
  )
}
```

### 독립적으로 사업자 확인만 사용하기

```tsx
import { BusinessVerifyDrawer } from "domains/verify/business/business-verify-drawer"

function MyComponent() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>
        사업자 확인하기
      </button>
      
      <BusinessVerifyDrawer
        open={open}
        onOpenChange={setOpen}
        onComplete={() => {
          console.log("확인 완료!")
          setOpen(false)
        }}
      />
    </>
  )
}
```

### 2단계 플로우로 사용하기 (휴대폰 인증 → 사업자 확인)

현재 `/mypage/verify` 페이지에서 구현된 방식입니다.

```tsx
import { PhoneVerifyDrawer } from "domains/verify/phone/phone-verify-drawer"
import { BusinessVerifyDrawer } from "domains/verify/business/business-verify-drawer"

function VerificationFlow() {
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [businessOpen, setBusinessOpen] = useState(false)

  return (
    <>
      <button onClick={() => setPhoneOpen(true)}>
        인증 시작
      </button>

      {/* Step 1: 휴대폰 인증 */}
      <PhoneVerifyDrawer
        open={phoneOpen}
        onOpenChange={setPhoneOpen}
        onComplete={() => {
          setPhoneOpen(false)
          setBusinessOpen(true) // 다음 단계로
        }}
      />

      {/* Step 2: 사업자 확인 */}
      <BusinessVerifyDrawer
        open={businessOpen}
        onOpenChange={setBusinessOpen}
        onBack={() => {
          setBusinessOpen(false)
          setPhoneOpen(true) // 이전 단계로
        }}
        onComplete={() => {
          setBusinessOpen(false)
          // 완료 처리
        }}
      />
    </>
  )
}
```

## 특징

- **낮은 결합도**: 각 컴포넌트는 독립적으로 사용 가능
- **반응형 UI**: 
  - 모바일: 바텀에서 올라오는 시트
  - 데스크탑: 중앙 모달
- **유연한 플로우**: 단일 사용 또는 다단계 플로우 모두 지원
