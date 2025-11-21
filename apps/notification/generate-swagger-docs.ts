import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

async function generateSwaggerDocs() {
  console.log('🚀 Notification Service Swagger 문서 생성 중...');
  
  try {
    // Swagger 문서 생성용 더미 환경 변수 설정 (모듈 로드 전에 설정)
    process.env.GENERATE_SWAGGER = 'true'; // Swagger 생성 모드 플래그 (검증 스킵)
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
    process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'dummy@example.com';
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
    process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
    process.env.PORT = '5001';
    
    console.log('📝 환경 변수 설정 완료');
    console.log('📦 NotificationModule 로드 중...');
    
    // 모듈을 동적으로 로드하기 전에 환경 변수 설정
    const { NotificationModule } = await import('./src/notification.module');
    
    console.log('✅ NotificationModule 로드 완료');
    console.log('🏗️  NestFactory로 앱 인스턴스 생성 중...');
    
    // 앱 인스턴스 생성 (실제 서버 시작 없이, 타임아웃 설정)
    const createAppPromise = NestFactory.create(NotificationModule, {
      logger: false, // 로그 비활성화
    });
    
    // 타임아웃 설정 (90초) - DB/Redis 연결 대기
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('앱 생성 타임아웃 (90초)')), 90000);
    });
    
    let app;
    try {
      app = await Promise.race([createAppPromise, timeoutPromise]) as any;
    } catch (error) {
      if (error instanceof Error && error.message.includes('타임아웃')) {
        console.error('⚠️  타임아웃 발생: DB/Redis 연결이 필요할 수 있습니다.');
        console.error('💡 PostgreSQL을 실행하거나 서버를 실행한 후 http://localhost:5001/api/docs-json 에서 문서를 가져오세요');
        throw error;
      }
      throw error;
    }
    
    console.log('✅ 앱 인스턴스 생성 완료');

    // Swagger 설정 (main.ts와 동일)
    const config = new DocumentBuilder()
      .setTitle('Notification Service API')
      .setDescription('알몬드영 알림 서비스 API 문서')
      .setVersion('1.0')
      .addTag('templates', '템플릿 관리')
      .addTag('notifications', '알림 발송')
      .addTag('providers', '알림 제공업체 관리')
      .addTag('bulk', '대량 발송')
      .addTag('dispatcher', '알림 디스패처')
      .addTag('event-handlers', '이벤트 핸들러')
      .addTag('webhooks', '웹훅 처리')
      .addTag('metrics', '메트릭 조회')
      .addTag('logs', '로그 조회')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'access-token',
      )
      .build();

    // Swagger 문서 생성
    console.log('📄 Swagger 문서 생성 중...');
    const document = SwaggerModule.createDocument(app, config);
    console.log('✅ Swagger 문서 생성 완료');
    
    // 출력 디렉토리 생성
    const outputDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // JSON 파일로 저장
    const jsonPath = path.join(outputDir, 'swagger.json');
    fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2));
    console.log(`✅ JSON 문서 생성 완료: ${jsonPath}`);

    // 루트의 swagger-spec.json도 업데이트 (기존 파일이 있는 경우)
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

    // 앱 종료
    await app.close();

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
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  generateSwaggerDocs();
}

export { generateSwaggerDocs };
