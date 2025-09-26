const fs = require('fs');

// JSON 파일 읽기
const swaggerJson = JSON.parse(fs.readFileSync('docs/swagger.json', 'utf8'));

// HTML 템플릿 생성
const html = `<!DOCTYPE html>
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
      const swaggerSpec = ${JSON.stringify(swaggerJson, null, 2)};
      
      const ui = SwaggerUIBundle({
        spec: swaggerSpec,
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

// 파일 저장
fs.writeFileSync('docs/swagger-standalone.html', html);
console.log('✅ 노션용 독립형 HTML 파일 생성 완료: docs/swagger-standalone.html');
console.log('📄 파일 크기:', (fs.statSync('docs/swagger-standalone.html').size / 1024).toFixed(1) + 'KB');
