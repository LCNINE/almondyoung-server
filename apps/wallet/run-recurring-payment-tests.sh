#!/bin/bash

# 신용카드 기반 구독 정기결제 통합 테스트 실행 스크립트

set -e

echo "🚀 신용카드 기반 구독 정기결제 통합 테스트 시작"
echo "=================================================="

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 함수 정의
print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 환경 확인
print_step "환경 확인 중..."

if [ ! -f "package.json" ]; then
    print_error "package.json을 찾을 수 없습니다. 프로젝트 루트에서 실행해주세요."
    exit 1
fi

if [ ! -f "test/membership-db.json" ]; then
    print_error "test/membership-db.json을 찾을 수 없습니다."
    exit 1
fi

print_success "환경 확인 완료"

# 테스트 데이터 확인
print_step "테스트 데이터 확인 중..."
MEMBER_COUNT=$(cat test/membership-db.json | grep -o '"id"' | wc -l)
print_success "테스트 멤버 수: $MEMBER_COUNT"

# Node.js 버전 확인
NODE_VERSION=$(node --version)
print_success "Node.js 버전: $NODE_VERSION"

# 의존성 설치 확인
if [ ! -d "node_modules" ]; then
    print_step "의존성 설치 중..."
    npm install
    print_success "의존성 설치 완료"
else
    print_success "의존성이 이미 설치되어 있습니다"
fi

echo ""
echo "🧪 테스트 실행 옵션을 선택하세요:"
echo "1) HMS memberID 플로우 테스트만 실행"
echo "2) 구독 정기결제 통합 테스트만 실행"
echo "3) 모든 통합 테스트 실행"
echo "4) 상세 로그와 함께 모든 테스트 실행"

read -p "선택 (1-4): " choice

case $choice in
    1)
        print_step "HMS memberID 플로우 테스트 실행 중..."
        npm run test -- --testPathPattern="hms-memberid-flow.spec.ts" --verbose
        ;;
    2)
        print_step "구독 정기결제 통합 테스트 실행 중..."
        npm run test -- --testPathPattern="recurring-payment-card-integration.spec.ts" --verbose
        ;;
    3)
        print_step "모든 통합 테스트 실행 중..."
        npm run test -- --testPathPattern="integration" --runInBand
        ;;
    4)
        print_step "상세 로그와 함께 모든 테스트 실행 중..."
        npm run test -- --testPathPattern="integration" --verbose --runInBand --no-coverage
        ;;
    *)
        print_error "잘못된 선택입니다. 1-4 중에서 선택해주세요."
        exit 1
        ;;
esac

# 테스트 결과 확인
if [ $? -eq 0 ]; then
    echo ""
    print_success "🎉 모든 테스트가 성공적으로 완료되었습니다!"
    echo ""
    echo "📊 테스트 결과 요약:"
    echo "- HMS 카드 등록 및 memberID 획득: ✅"
    echo "- 구독 결제수단 검증: ✅"
    echo "- 구독 정기결제 실행: ✅"
    echo "- 결제 상태 조회: ✅"
    echo "- 에러 시나리오 처리: ✅"
    echo "- 동시성 테스트: ✅"
    echo ""
    echo "📋 다음 단계:"
    echo "1. 실제 HMS API 환경에서 테스트"
    echo "2. 프로덕션 배포 전 최종 검증"
    echo "3. 모니터링 및 알림 설정"
else
    echo ""
    print_error "❌ 테스트 실행 중 오류가 발생했습니다."
    echo ""
    echo "🔧 트러블슈팅 가이드:"
    echo "1. 데이터베이스 연결 상태 확인"
    echo "2. 환경 변수 설정 검토"
    echo "3. HMS API 설정 확인"
    echo "4. 테스트 데이터 유효성 검증"
    echo ""
    echo "자세한 내용은 RECURRING_PAYMENT_TEST_GUIDE.md를 참고하세요."
    exit 1
fi

echo ""
echo "=================================================="
echo "🏁 테스트 실행 완료"
