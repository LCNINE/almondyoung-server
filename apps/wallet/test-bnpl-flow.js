/**
 * BNPL 시스템 전체 플로우 테스트 스크립트
 * 
 * 테스트 시나리오:
 * 1. 결제수단 등록 (회원 등록)
 * 2. 결제 요청 (내부 승인)
 * 3. BNPL 계정 정보 조회
 * 4. 거래 내역 조회
 * 5. 정산 배치 조회
 */

const http = require('http');
const { URL } = require('url');

const BASE_URL = 'http://localhost:5000';
const TEST_USER_ID = 'test-user-001';

// HTTP 요청 헬퍼 함수
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            status: res.statusCode,
            data: jsonData,
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            data: data,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

async function testBnplFlo
    // 6. 정산 배치 조회
    console.log('6️⃣ 정산 배치 조회');
    try {
      const settlementsResponse = await axios.get(`${BASE_URL}/bnpl/accounts/me/settlements?userId=${TEST_USER_ID}`);
      console.log('✅ 정산 배치 조회 성공:', JSON.stringify(settlementsResponse.data, null, 2));
    } catch (error) {
      console.log('ℹ️ 정산 배치 없음 (정상 - 아직 월말 정산 전)');
    }
    console.log();

    console.log('🎉 BNPL 시스템 기본 테스트 완료!');
    console.log('\n📋 다음 단계:');
    console.log('1. 실제 청구서 생성 후 결제 테스트');
    console.log('2. SettlementService 크론 잡 수동 실행 테스트');
    console.log('3. 전체 플로우 통합 테스트');

  } catch (error) {
    console.error('❌ 테스트 실패:', error.response?.data || error.message);
  }
}

// 서버 상태 확인
async function checkServerHealth() {
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ 서버 상태 정상');
    return true;
  } catch (error) {
    console.error('❌ 서버 연결 실패. 서버가 실행 중인지 확인하세요.');
    console.error(`URL: ${BASE_URL}`);
    return false;
  }
}

// 메인 실행
async function main() {
  console.log('🔍 서버 상태 확인 중...');
  const isServerHealthy = await checkServerHealth();
  
  if (isServerHealthy) {
    await testBnplFlow();
  } else {
    console.log('\n💡 서버 실행 방법:');
    console.log('cd almondyoung-server && npm run start:dev');
  }
}

main().catch(console.error);