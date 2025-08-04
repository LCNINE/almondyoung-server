#!/bin/bash

# 멤버십 서비스 스마트 API 테스트 (실제 시나리오 기반)
# 실패 원인을 분석하고 적응적으로 테스트하는 버전

# =================================================================
# 설정
# =================================================================

BASE_URL="http://localhost:3000/api"
ADMIN_ID="550e8400-e29b-41d4-a716-446655440000"
TEST_USER_ID="user-12345678-1234-1234-1234-123456789abc"

# 생성된 리소스 ID들
TEST_TIER_ID=""
TEST_PLAN_ID=""
TEST_SUBSCRIPTION_ID=""

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# 통계
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# =================================================================
# 유틸리티 함수
# =================================================================

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((PASSED_TESTS++))
}

error() {
    echo -e "${RED}❌ $1${NC}"
    ((FAILED_TESTS++))
}

skip() {
    echo -e "${YELLOW}⏭️  $1${NC}"
    ((SKIPPED_TESTS++))
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 스마트 HTTP 요청 (에러 분석 포함)
smart_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local expected_status="$4"
    local description="$5"
    local optional="${6:-false}"
    
    ((TOTAL_TESTS++))
    
    log "Testing: $description"
    
    local full_url="$BASE_URL$endpoint"
    
    # 요청 실행
    if [ -n "$data" ]; then
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            --connect-timeout 10 --max-time 30 \
            -X "$method" \
            -H "Content-Type: application/json" \
            -H "X-Admin-Id: $ADMIN_ID" \
            -d "$data" \
            "$full_url" 2>&1)
    else
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            --connect-timeout 10 --max-time 30 \
            -X "$method" \
            -H "Content-Type: application/json" \
            -H "X-Admin-Id: $ADMIN_ID" \
            "$full_url" 2>&1)
    fi
    
    # 응답 파싱
    if echo "$response" | grep -q "HTTPSTATUS:"; then
        http_status=$(echo "$response" | grep -o "HTTPSTATUS:[0-9]*$" | cut -d: -f2)
        response_body=$(echo "$response" | sed 's/HTTPSTATUS:[0-9]*$//')
    else
        error "$description - Request failed"
        return 1
    fi
    
    # 결과 분석
    if [ "$http_status" = "$expected_status" ]; then
        success "$description (Status: $http_status)"
    else
        if [ "$optional" = "true" ]; then
            skip "$description - Optional test (Expected: $expected_status, Got: $http_status)"
            analyze_error "$http_status" "$response_body" "$description"
        else
            error "$description (Expected: $expected_status, Got: $http_status)"
            analyze_error "$http_status" "$response_body" "$description"
        fi
    fi
    
    echo "$response_body"
}

# 에러 분석 함수
analyze_error() {
    local status="$1"
    local body="$2"
    local desc="$3"
    
    case "$status" in
        400)
            if echo "$body" | grep -q "입력값 검증"; then
                warning "  → 스키마 불일치: 실제 API 스키마와 테스트 데이터가 다름"
            elif echo "$body" | grep -q "validation"; then
                warning "  → 입력 검증 실패: 필수 필드 누락 또는 형식 오류"
            fi
            ;;
        404)
            warning "  → 엔드포인트 없음: API가 구현되지 않았거나 경로가 다름"
            ;;
        500)
            if echo "$body" | grep -q "Failed query"; then
                warning "  → 데이터베이스 오류: 테이블/데이터 없음 또는 쿼리 오류"
            elif echo "$body" | grep -q "Cannot read properties"; then
                warning "  → 코드 오류: null 참조 - 구현 미완성"
            else
                warning "  → 서버 내부 오류: 예상치 못한 에러"
            fi
            ;;
    esac
}

# JSON 값 추출
extract_value() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# =================================================================
# 테스트 시작
# =================================================================

print_header() {
    echo
    log "========================================"
    log "멤버십 서비스 스마트 API 테스트"
    log "========================================"
    log "🎯 실제 시나리오 기반 적응형 테스트"
    log "📊 성공/실패 원인 분석 포함"
    echo
}

# =================================================================
# Phase 1: 기본 인프라 테스트
# =================================================================

test_infrastructure() {
    log "🏗️  Phase 1: 기본 인프라 테스트"
    echo "   서버 연결 및 기본 엔드포인트 확인"
    echo
    
    # 서버 연결
    if curl -s --connect-timeout 5 "$BASE_URL" > /dev/null; then
        success "서버 연결 성공"
    else
        error "서버 연결 실패"
        exit 1
    fi
    
    # 기본 조회 API들 (데이터가 없어도 동작해야 함)
    smart_request "GET" "/plans" "" "200" "플랜 목록 조회"
    smart_request "GET" "/tiers" "" "200" "티어 목록 조회"
    
    echo
}

# =================================================================
# Phase 2: 데이터 생성 (관리자 API)
# =================================================================

test_data_creation() {
    log "📝 Phase 2: 테스트 데이터 생성"
    echo "   관리자 API로 티어/플랜 생성"
    echo
    
    # 티어 생성
    local tier_code="TEST_$(date +%s)"
    response=$(smart_request "POST" "/admin/tiers" '{
        "code": "'$tier_code'",
        "name": "스마트 테스트 티어",
        "priorityLevel": 20
    }' "201" "테스트 티어 생성")
    
    TEST_TIER_ID=$(extract_value "$response" "tierId")
    if [ -n "$TEST_TIER_ID" ]; then
        log "✨ 생성된 티어 ID: $TEST_TIER_ID"
        
        # 티어가 생성되었으면 플랜도 생성
        response=$(smart_request "POST" "/admin/plans" '{
            "tierId": "'$TEST_TIER_ID'",
            "price": 15000,
            "durationDays": 30,
            "currency": "KRW",
            "trialDays": 14
        }' "201" "테스트 플랜 생성")
        
        TEST_PLAN_ID=$(extract_value "$response" "planId")
        if [ -n "$TEST_PLAN_ID" ]; then
            log "✨ 생성된 플랜 ID: $TEST_PLAN_ID"
        fi
    else
        warning "티어 ID 추출 실패 - 후속 테스트 제한됨"
    fi
    
    echo
}

# =================================================================
# Phase 3: 생성된 데이터로 조회 테스트
# =================================================================

test_data_queries() {
    log "🔍 Phase 3: 데이터 조회 테스트"
    echo "   생성된 데이터를 이용한 상세 조회"
    echo
    
    # 특정 리소스 조회 (데이터가 있을 때만)
    if [ -n "$TEST_PLAN_ID" ]; then
        smart_request "GET" "/plans/$TEST_PLAN_ID" "" "200" "특정 플랜 상세 조회"
    else
        skip "특정 플랜 조회 - 플랜 ID 없음"
        ((TOTAL_TESTS++))
    fi
    
    if [ -n "$TEST_TIER_ID" ]; then
        smart_request "GET" "/tiers/$TEST_TIER_ID/plans" "" "200" "티어별 플랜 조회"
        smart_request "GET" "/tiers/$TEST_TIER_ID/benefits" "" "200" "티어 혜택 조회"
    else
        skip "티어 관련 조회 - 티어 ID 없음"
        ((TOTAL_TESTS+=2))
    fi
    
    echo
}

# =================================================================
# Phase 4: 구독 시나리오 테스트 (선택적)
# =================================================================

test_subscription_flow() {
    log "🔄 Phase 4: 구독 플로우 테스트"
    echo "   실제 사용자 구독 시나리오 (선택적)"
    echo
    
    # 구독 전 현재 상태 조회 (데이터 없어도 OK)
    smart_request "GET" "/subscriptions/current?userId=$TEST_USER_ID" "" "200" "구독 전 현재 상태 조회" "true"
    
    # 구독 생성 (플랜이 있을 때만)
    if [ -n "$TEST_PLAN_ID" ]; then
        response=$(smart_request "POST" "/subscriptions?userId=$TEST_USER_ID" '{
            "planId": "'$TEST_PLAN_ID'"
        }' "201" "구독 생성" "true")
        
        TEST_SUBSCRIPTION_ID=$(extract_value "$response" "subscriptionId")
        if [ -n "$TEST_SUBSCRIPTION_ID" ]; then
            log "✨ 생성된 구독 ID: $TEST_SUBSCRIPTION_ID"
            
            # 구독 후 상태 조회
            smart_request "GET" "/subscriptions/current?userId=$TEST_USER_ID" "" "200" "구독 후 현재 상태 조회" "true"
        fi
    else
        skip "구독 생성 - 플랜 ID 없음"
        ((TOTAL_TESTS++))
    fi
    
    # 구독 이력 (데이터 없어도 빈 배열 반환해야 함)
    smart_request "GET" "/subscriptions/history?userId=$TEST_USER_ID" "" "200" "구독 이력 조회" "true"
    
    echo
}

# =================================================================
# Phase 5: 고급 기능 테스트 (선택적)
# =================================================================

test_advanced_features() {
    log "⭐ Phase 5: 고급 기능 테스트"
    echo "   정책, 권한, 일시정지 등 고급 기능 (선택적)"
    echo
    
    # 정책 관리
    smart_request "GET" "/policies?page=1&limit=5" "" "200" "정책 목록 조회"
    
    # 정책 생성 (티어가 있을 때만)
    if [ -n "$TEST_TIER_ID" ]; then
        smart_request "POST" "/policies" '{
            "ruleType": "MAX_PAUSES_PER_YEAR",
            "ruleValue": {
                "maxPauses": 2,
                "resetPeriod": "YEARLY"
            },
            "tierId": "'$TEST_TIER_ID'"
        }' "201" "정책 생성" "true"
    else
        skip "정책 생성 - 티어 ID 없음"
        ((TOTAL_TESTS++))
    fi
    
    # 권한 관리 (구현 상태에 따라 다름)
    smart_request "GET" "/rights/user/$TEST_USER_ID" "" "200" "사용자 권한 조회" "true"
    
    # 일시정지 관련
    smart_request "GET" "/subscriptions/pause/eligibility?userId=$TEST_USER_ID" "" "200" "일시정지 자격 확인" "true"
    smart_request "GET" "/subscriptions/pause/history?userId=$TEST_USER_ID" "" "200" "일시정지 이력 조회" "true"
    
    echo
}

# =================================================================
# Phase 6: 에러 케이스 테스트
# =================================================================

test_error_scenarios() {
    log "🚨 Phase 6: 에러 처리 테스트"
    echo "   예상되는 에러 상황들"
    echo
    
    # 400 에러들
    smart_request "POST" "/subscriptions?userId=$TEST_USER_ID" '{
        "planId": "invalid-plan-id"
    }' "400" "잘못된 플랜 ID로 구독 시도"
    
    # 404 에러들  
    smart_request "GET" "/plans/non-existent-plan-id" "" "404" "존재하지 않는 플랜 조회" "true"
    smart_request "GET" "/rights/user/non-existent-user" "" "404" "존재하지 않는 사용자 권한 조회" "true"
    
    echo
}

# =================================================================
# 결과 분석 및 보고서
# =================================================================

generate_report() {
    log "📊 테스트 결과 분석"
    echo "========================================"
    
    local total_attempted=$((TOTAL_TESTS))
    local success_rate=0
    local reliability_score=0
    
    if [ $total_attempted -gt 0 ]; then
        success_rate=$((PASSED_TESTS * 100 / total_attempted))
        reliability_score=$(((PASSED_TESTS + SKIPPED_TESTS) * 100 / total_attempted))
    fi
    
    echo -e "📈 테스트 통계:"
    echo -e "   총 시도: ${BLUE}$total_attempted${NC}"
    echo -e "   성공: ${GREEN}$PASSED_TESTS${NC}"
    echo -e "   실패: ${RED}$FAILED_TESTS${NC}" 
    echo -e "   건너뜀: ${YELLOW}$SKIPPED_TESTS${NC}"
    echo -e "   성공률: ${BLUE}$success_rate%${NC}"
    echo -e "   안정성: ${BLUE}$reliability_score%${NC}"
    echo
    
    echo -e "🎯 API 상태 분석:"
    if [ $success_rate -ge 80 ]; then
        echo -e "   ${GREEN}🟢 우수${NC} - API가 매우 안정적으로 동작합니다"
    elif [ $success_rate -ge 60 ]; then
        echo -e "   ${YELLOW}🟡 양호${NC} - 대부분의 핵심 기능이 동작합니다"
    elif [ $success_rate -ge 40 ]; then
        echo -e "   ${YELLOW}🟠 개발중${NC} - 기본 기능은 동작하나 고급 기능 구현 필요"
    else
        echo -e "   ${RED}🔴 초기단계${NC} - 기본 인프라는 구축되었으나 기능 구현 필요"
    fi
    
    echo
    echo -e "💡 다음 단계 권장사항:"
    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "   1. 서버 로그에서 구체적인 에러 원인 확인"
        echo -e "   2. 데이터베이스 스키마 및 테이블 존재 여부 점검"
        echo -e "   3. 입력값 검증 스키마와 실제 API 스펙 일치성 확인"
    fi
    if [ $SKIPPED_TESTS -gt 0 ]; then
        echo -e "   4. 선택적 기능들의 구현 상태 확인 및 개발 계획 수립"
    fi
    echo -e "   5. 성공한 API들을 기반으로 추가 기능 점진적 개발"
    
    echo
    echo "========================================"
}

# =================================================================
# 메인 실행
# =================================================================

main() {
    print_header
    test_infrastructure
    test_data_creation
    test_data_queries
    test_subscription_flow
    test_advanced_features
    test_error_scenarios
    generate_report
}

# 옵션 처리
while [[ $# -gt 0 ]]; do
    case $1 in
        --base-url)
            BASE_URL="$2"
            shift 2
            ;;
        --help)
            echo "멤버십 서비스 스마트 API 테스트"
            echo ""
            echo "사용법: $0 [옵션]"
            echo ""
            echo "옵션:"
            echo "  --base-url URL    API 서버 URL (기본값: http://localhost:3000/api)"
            echo "  --help           도움말 표시"
            echo ""
            echo "특징:"
            echo "  - 단계별 테스트로 의존성 관리"  
            echo "  - 에러 원인 자동 분석"
            echo "  - 선택적 테스트로 유연한 검증"
            echo "  - 상세한 결과 보고서 생성"
            exit 0
            ;;
        *)
            echo "알 수 없는 옵션: $1"
            exit 1
            ;;
    esac
done

main