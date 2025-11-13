import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './src/app.module';
import * as fs from 'fs';
import * as path from 'path';

async function generateSwaggerDocs() {
  console.log('🚀 User Service Swagger 문서 생성 중...');

  try {
    // 앱 인스턴스 생성 (실제 서버 시작 없이)
    const app = await NestFactory.create(AppModule, {
      logger: false, // 로그 비활성화
    });

    // Swagger 설정 (main.ts와 동일)
    const config = new DocumentBuilder()
      .setTitle('User Service API')
      .setDescription('The User Service API description')
      .setVersion('1.0')
      .addTag('Auth', '인증 관련 API')
      .addTag('Users', '사용자 관련 API')
      .addTag('Admin', '관리자 관련 API')
      .addTag('Admin/Roles', '관리자 권한 관련 API')
      .addTag('Admin/Scopes', '관리자 스코프 관련 API')
      .addTag('Admin/Dormant', '휴면 계정 관련 API')
      .addTag('Shop', '상점 관련 API')
      .addTag('Twilio - 인증 메시지', 'Twilio 인증 코드 발송 API')
      .addTag('Twilio - 인증 확인', 'Twilio 인증 코드 검증 API')
      .addTag('Twilio - 전화번호 조회', 'Twilio 전화번호 유효성 검증 API')
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
  <title>User Service API</title>
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
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  generateSwaggerDocs();
}

export { generateSwaggerDocs };
