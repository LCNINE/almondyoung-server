import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NotificationModule } from './src/notification.module';
import * as fs from 'fs';
import * as path from 'path';

async function generateSwaggerDocs() {
  console.log('🚀 Notification Service Swagger 문서 생성 중...');
  
  try {
    // 앱 인스턴스 생성 (실제 서버 시작 없이)
    const app = await NestFactory.create(NotificationModule, {
      logger: false, // 로그 비활성화
    });

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
      .addBearerAuth()
      .build();

    // Swagger 문서 생성
    const document = SwaggerModule.createDocument(app, config);
    
    // 출력 디렉토리 생성
    const outputDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // JSON 파일로 저장
    const jsonPath = path.join(outputDir, 'swagger.json');
    fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2));
    console.log(`✅ JSON 문서 생성 완료: ${jsonPath}`);

    // HTML 파일로 저장
    const htmlPath = path.join(outputDir, 'swagger.html');
    
    // Swagger UI HTML 템플릿 생성
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
      const ui = SwaggerUIBundle({
        url: './swagger.json',
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
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  generateSwaggerDocs();
}

export { generateSwaggerDocs };
