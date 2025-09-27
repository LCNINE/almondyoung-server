#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Starting itdoc test and documentation generation...');

try {
    // 1. Run itdoc tests
    console.log('📝 Running itdoc tests...');
    console.log('⚠️  Note: Make sure your database is set up and seeded with test data');
    execSync('npm run test:membership:itdoc', {
        stdio: 'inherit',
        cwd: process.cwd()
    });

    // 2. Generate documentation
    console.log('📚 Generating API documentation...');
    execSync('npx itdoc', {
        stdio: 'inherit',
        cwd: process.cwd()
    });

    console.log('✅ Documentation generated successfully!');
    console.log('📖 Check the docs/api directory for generated documentation');
    console.log('🌐 Run "npm run docs:serve" to serve the documentation locally');

} catch (error) {
    console.error('❌ Error during itdoc test and documentation generation:', error.message);
    process.exit(1);
}