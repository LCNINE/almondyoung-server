import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

async function fetchSwaggerFromServer(): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5001,
      path: '/api/docs-json',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`JSON 파싱 실패: ${error}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`요청 실패: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('서버 연결 타임아웃 (10초)'));
    });

    req.end();
  });
}

async function waitForServer(maxAttempts = 30, delay = 1000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetchSwaggerFromServer();
      return; // 서버가 준비됨
    } catch {
      // 서버가 아직 준비되지 않음
      if (i < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`서버가 ${maxAttempts * delay / 1000}초 내에 시작되지 않았습니다`);
}

async function generateSwaggerDocs() {
  console.log('🚀 Notification Service Swagger 문서 생성 중...');
  console.log('📡 서버에서 Swagger 문서 가져오기 시도...');
  console.log('💡 서버가 실행 중이 아니면 먼저 서버를 실행해주세요: npm run start:dev');

  try {
    // 서버가 준비될 때까지 대기
    console.log('⏳ 서버 준비 대기 중...');
    await waitForServer(30, 2000);
    console.log('✅ 서버 준비 완료');
    
    const document = await fetchSwaggerFromServer();
    console.log('✅ Swagger 문서 가져오기 성공');

    // 출력 디렉토리 생성
    const outputDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // JSON 파일로 저장
    const jsonPath = path.join(outputDir, 'swagger.json');
    fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2));
    console.log(`✅ JSON 문서 생성 완료: ${jsonPath}`);

    // 루트의 swagger-spec.json도 업데이트
    const rootJsonPath = path.join(__dirname, 'swagger-spec.json');
    fs.writeFileSync(rootJsonPath, JSON.stringify(document, null, 2));
    console.log(`✅ Root JSON 문서 업데이트 완료: ${rootJsonPath}`);

    // HTML 파일로 저장
    const htmlPath = path.join(outputDir, 'swagger.html');

    // Swagger UI HTML 템플릿 생성 (스펙을 인라인으로 포함)
    const swaggerHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notification Service API</title>
  <link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const spec = ${JSON.stringify(document, null, 2)};
      
      const ui = SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        validatorUrl: null,
        tryItOutEnabled: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        onComplete: function() {
          console.log('Swagger UI 로드 완료');
        }
      });
    };
  </script>
</body>
</html>`;

    fs.writeFileSync(htmlPath, swaggerHtml);
    console.log(`✅ HTML 문서 생성 완료: ${htmlPath}`);

    console.log('\n🎉 Swagger 문서 생성이 완료되었습니다!');
    console.log(`📁 문서 위치: ${outputDir}`);
    console.log(`📄 HTML 파일: ${htmlPath}`);
    console.log(`📄 JSON 파일: ${jsonPath}`);
    console.log('\n💡 사용법:');
    console.log(`   - HTML 파일을 브라우저에서 열어보세요: file://${htmlPath}`);
    console.log(`   - 또는 로컬 서버로 제공: npx serve ${outputDir}`);

  } catch (error) {
    console.error('❌ 문서 생성 중 오류 발생:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('\n💡 해결 방법:');
      console.error('   1. Notification 서버가 실행 중인지 확인하세요 (포트 5001)');
      console.error('   2. 서버 실행: cd apps/notification && npm run start:dev');
      console.error('   3. 또는 PostgreSQL을 실행한 후 generate-swagger-docs.ts를 실행하세요');
    }
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  generateSwaggerDocs();
}

export { generateSwaggerDocs };

