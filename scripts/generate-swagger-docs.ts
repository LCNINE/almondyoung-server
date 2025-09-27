#!/usr/bin/env ts-node

// Register module path mapping for @app/* imports
import 'tsconfig-paths/register';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

interface SwaggerConfig {
  apps: {
    [key: string]: {
      title: string;
      description: string;
      version: string;
      appModule: string;
      outputPath: string;
      port: number;
    };
  };
}

async function generateSwaggerDocs(appName: string) {
  try {
    // Load configuration
    const configPath = path.join(process.cwd(), 'swagger-config.json');
    const config: SwaggerConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (!config.apps[appName]) {
      console.error(`❌ App "${appName}" not found in swagger-config.json`);
      console.log(`Available apps: ${Object.keys(config.apps).join(', ')}`);
      process.exit(1);
    }

    const appConfig = config.apps[appName];
    console.log(`📝 Generating Swagger documentation for ${appConfig.title}...`);

    // Dynamically import the app module
    const moduleFile = path.resolve(appConfig.appModule);
    if (!fs.existsSync(moduleFile)) {
      console.error(`❌ Module file not found: ${moduleFile}`);
      process.exit(1);
    }

    const moduleExports = await import(moduleFile);

    // Try to get the module - could be default export or named export
    let AppModule;
    if (appName === 'wms') {
      AppModule = moduleExports.WmsModule || moduleExports.default;
    } else if (appName === 'pim') {
      AppModule = moduleExports.PimModule || moduleExports.default;
    } else {
      // For other apps, try common patterns
      AppModule = moduleExports.default || moduleExports[Object.keys(moduleExports)[0]];
    }

    if (!AppModule) {
      console.error(`❌ Could not import AppModule from ${moduleFile}`);
      console.error(`Available exports:`, Object.keys(moduleExports));
      process.exit(1);
    }

    // Create NestJS application
    const app = await NestFactory.create(AppModule, { logger: false });

    // Setup Swagger
    const config_builder = new DocumentBuilder()
      .setTitle(appConfig.title)
      .setDescription(appConfig.description)
      .setVersion(appConfig.version)
      .build();

    const document = SwaggerModule.createDocument(app, config_builder);

    // Generate HTML content
    const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <title>${appConfig.title}</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
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
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        spec: ${JSON.stringify(document, null, 2)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

    // Ensure output directory exists
    const outputDir = path.dirname(appConfig.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write HTML file
    fs.writeFileSync(appConfig.outputPath, htmlTemplate);

    console.log(`✅ Swagger documentation generated successfully!`);
    console.log(`📄 Output: ${appConfig.outputPath}`);
    console.log(`🔗 You can open this file in a browser to view the API documentation`);

    // Close the application
    await app.close();

  } catch (error) {
    console.error('❌ Error generating Swagger documentation:', error);
    process.exit(1);
  }
}

// Main execution
const appName = process.argv[2];

if (!appName) {
  console.error('❌ Please specify an app name');
  console.log('Usage: npm run docs:generate <app-name>');
  console.log('Example: npm run docs:generate wms');
  process.exit(1);
}

generateSwaggerDocs(appName).then(() => {
  console.log('🎉 Documentation generation completed!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Failed to generate documentation:', error);
  process.exit(1);
});