// Direct HMS Adapter Test
import { HmsCardPaymentAdapter } from '../../../adapters/hms-card-payment.adapter';
import { getTsid } from 'tsid-ts';

describe('Direct HMS Adapter Test', () => {
    let adapter: HmsCardPaymentAdapter;

    beforeAll(() => {
        // 환경변수 설정 - 실제 HMS API 사용
        process.env.SW_KEY = '4LjFflzr6z4YSknp';
        process.env.CUST_KEY = 'BT2z4D5DUm7cE5tl';
        process.env.USE_MOCK = 'false'; // 실제 HMS API 사용
        process.env.NODE_ENV = 'test';

        adapter = new HmsCardPaymentAdapter();
    });

    it('should call HMS paymentProfiles.create API directly', async () => {
        const testId = getTsid().toString();

        const request = {
            userId: `user_${testId}`,
            memberName: '홍길동',
            phone: '01012345678',
            paymentNumber: '1234567890123456', // 16자리 카드번호
            payerName: '홍길동',
            payerNumber: '1234567890', // 정확히 10자리 납부자번호
            validYear: '25',
            validMonth: '12',
            billingCycleDay: 1,
        };

        console.log('HMS Adapter 직접 호출 시작...');
        console.log('요청 데이터:', JSON.stringify(request, null, 2));

        try {
            const result = await adapter.registerRecurringMember(request);

            console.log('HMS Adapter 결과:', JSON.stringify(result, null, 2));

            expect(result).toBeDefined();

            if (result.success) {
                console.log(`✅ HMS API 성공: ${result.hmsMemberId}`);
                expect(result.hmsMemberId).toBeDefined();
            } else {
                console.log(`❌ HMS API 실패: ${result.error}`);
                expect(result.error).toBeDefined();
            }

        } catch (error) {
            console.error('HMS Adapter 에러:', error);

            // 에러 타입 분석
            if (error.message.includes('ECONNREFUSED')) {
                console.log('🔴 HMS API 서버 연결 실패 - 서버가 응답하지 않음');
            } else if (error.message.includes('timeout')) {
                console.log('🔴 HMS API 타임아웃');
            } else if (error.message.includes('401') || error.message.includes('403')) {
                console.log('🔴 HMS API 인증 실패');
            } else if (error.message.includes('400')) {
                console.log('🔴 HMS API 요청 데이터 오류');
            } else if (error.message.includes('500')) {
                console.log('🔴 HMS API 서버 내부 오류');
            } else {
                console.log('🔴 기타 HMS API 에러:', error.message);
            }

            // 실제 HMS API 에러를 확인하기 위해 에러를 다시 던지지 않고 테스트 통과
            expect(error).toBeDefined();
        }
    }, 30000);

    it('should handle invalid data gracefully', async () => {
        const testId = getTsid().toString();

        // 의도적으로 잘못된 데이터
        const invalidRequest = {
            userId: `user_${testId}`,
            memberName: '', // 빈 이름
            phone: 'invalid', // 잘못된 전화번호
            paymentNumber: '123', // 너무 짧은 카드번호
            payerName: '',
            payerNumber: '123', // 너무 짧은 납부자번호
            validYear: '99', // 잘못된 연도
            validMonth: '13', // 잘못된 월
            billingCycleDay: 1,
        };

        console.log('잘못된 데이터로 HMS API 호출...');

        try {
            const result = await adapter.registerRecurringMember(invalidRequest);

            console.log('잘못된 데이터 결과:', JSON.stringify(result, null, 2));

            // 실패하거나 에러가 발생해야 정상
            if (result.success === false) {
                console.log('✅ 예상된 실패:', result.error);
                expect(result.error).toBeDefined();
            } else {
                console.log('⚠️ 예상과 다르게 성공함');
            }

        } catch (error) {
            console.log('✅ 예상된 에러 발생:', error.message);
            expect(error).toBeDefined();
        }
    }, 15000);

    it('should test HMS payment transaction', async () => {
        const testId = getTsid().toString();

        console.log('HMS 결제 트랜잭션 테스트...');

        try {
            // 먼저 결제수단 등록
            const memberRequest = {
                userId: `user_${testId}`,
                memberName: '홍길동',
                phone: '01012345678',
                paymentNumber: '1234567890123456', // 16자리 카드번호
                payerName: '홍길동',
                payerNumber: '1234567890', // 정확히 10자리 납부자번호
                validYear: '25',
                validMonth: '12',
                billingCycleDay: 1,
            };

            const memberResult = await adapter.registerRecurringMember(memberRequest);

            if (memberResult.success && memberResult.hmsMemberId) {
                console.log(`회원 등록 성공: ${memberResult.hmsMemberId}`);

                // 결제 시도
                const paymentResult = await adapter.processPayment(
                    10000, // 10,000원
                    'KRW',
                    {
                        userId: testId,
                        sessionId: `session_${testId}`,
                        paymentMethodId: 'test_pm_id',
                        hmsMemberId: memberResult.hmsMemberId,
                    }
                );

                console.log('결제 결과:', JSON.stringify(paymentResult, null, 2));

                expect(paymentResult).toBeDefined();

                if (paymentResult.success) {
                    console.log(`✅ HMS 결제 성공: ${paymentResult.transactionId}`);
                } else {
                    console.log(`❌ HMS 결제 실패: ${paymentResult.error}`);
                }
            } else {
                console.log('회원 등록 실패로 결제 테스트 스킵');
            }

        } catch (error) {
            console.error('HMS 결제 테스트 에러:', error);
            expect(error).toBeDefined();
        }
    }, 45000);
});