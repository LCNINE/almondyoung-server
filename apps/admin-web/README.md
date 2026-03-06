# Almond Young Admin

Next.js 15 + Tailwind CSS v4 + shadcn/ui로 구축된 관리자 대시보드 프로젝트입니다.

## 🚀 기술 스택

- **Next.js 15** - React 기반 풀스택 프레임워크
- **Tailwind CSS v4** - 최신 CSS 프레임워크 (5배 빠른 빌드 성능)
- **shadcn/ui** - 재사용 가능한 UI 컴포넌트 라이브러리
- **TypeScript** - 타입 안전성을 위한 정적 타입 검사
- **ESLint** - 코드 품질 및 일관성 유지

## ✨ Tailwind CSS v4 새로운 기능

- **고성능 엔진** - 전체 빌드 5배 빠름, 증분 빌드 100배 빠름
- **컨테이너 쿼리** - 요소 크기에 따른 반응형 디자인
- **3D 변환** - 3D 공간에서의 요소 변환
- **확장된 그라디언트** - 선형, 방사형, 원뿔형 그라디언트 지원
- **CSS Cascade Layers** - 스타일 우선순위 제어
- **자동 컨텐츠 감지** - 설정 없이 자동으로 템플릿 파일 감지

## 🛠️ 설치 및 실행

```bash
# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env.local

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build

# 프로덕션 서버 실행
npm start
```

## 🔧 환경변수 설정

`.env.local` 파일을 생성하고 다음 환경변수들을 설정하세요:

```env
# === Service URLs (for inter-service communication) ===
WMS_SERVICE_URL=http://localhost:3010
PIM_SERVICE_URL=http://localhost:3020
USER_SERVICE_URL=http://localhost:3030
WALLET_SERVICE_URL=http://localhost:3040
MEMBERSHIP_SERVICE_URL=http://localhost:3050
NOTIFICATION_SERVICE_URL=http://localhost:3060
CHANNEL_ADAPTER_SERVICE_URL=http://localhost:3070

# === API Gateway URL (for production) ===
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api

# === Development Settings ===
NODE_ENV=development
```

## 📁 프로젝트 구조

```
src/
├── app/                 # Next.js App Router
│   ├── globals.css     # 전역 스타일 (Tailwind CSS v4)
│   └── page.tsx        # 메인 페이지
├── components/         # React 컴포넌트
│   └── ui/            # shadcn/ui 컴포넌트
└── lib/               # 유틸리티 함수
    ├── api/           # API 클라이언트
    │   ├── client.ts  # 공통 HTTP 클라이언트 (Axios 인스턴스)
    │   └── domains/   # 도메인별 API 클라이언트
    └── utils.ts       # shadcn/ui 유틸리티
```

## 🔌 API 클라이언트 구조

### 서비스별 API 클라이언트
- **WMS Service** (포트 3010) - 창고 관리 시스템
- **PIM Service** (포트 3020) - 상품 정보 관리
- **User Service** (포트 3030) - 사용자 관리
- **Wallet Service** (포트 3040) - 지갑/결제 관리
- **Membership Service** (포트 3050) - 멤버십 관리
- **Notification Service** (포트 3060) - 알림 관리
- **Channel Adapter Service** (포트 3070) - 채널 어댑터


## 🎨 사용 가능한 컴포넌트

- Button (다양한 variant와 size 지원)
- Card (Header, Content, Description 포함)
- Input (폼 입력 필드)
- Label (접근성을 위한 라벨)

## 🔧 개발 명령어

```bash
# 타입 체크
npm run type-check

# 린트 검사
npm run lint

# 린트 수정
npm run lint:fix
```

## 📝 라이선스

MIT License
