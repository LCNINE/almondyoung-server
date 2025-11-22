#!/usr/bin/env node

/**
 * JWT Token Generator for Almondyoung Microservices
 * 
 * 테스트용 JWT 토큰을 생성하는 스크립트입니다.
 * 거의 영구적인 유효기간(100년)을 가진 토큰을 생성합니다.
 * 
 * Usage:
 *   node scripts/generate-jwt-token.js
 */

const jwt = require('jsonwebtoken');
const readline = require('readline');
const { randomUUID } = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 JWT Token Generator for Almondyoung Services');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // AUTH_SECRET 입력
  const authSecret = await question('AUTH_SECRET (필수): ');
  if (!authSecret || authSecret.trim() === '') {
    console.error('❌ AUTH_SECRET은 필수입니다.');
    rl.close();
    process.exit(1);
  }
  
  // User ID 입력
  let userId = await question('User ID (UUID, Enter로 자동생성): ');
  if (!userId || userId.trim() === '') {
    userId = randomUUID();
    console.log(`   → 자동 생성된 UUID: ${userId}`);
  } else if (!isValidUUID(userId)) {
    console.log('   ⚠️  UUID 형식이 아닙니다. 그대로 사용합니다.');
  }
  
  // Email 입력
  const email = await question('Email (기본: test@almondyoung.com): ') || 'test@almondyoung.com';
  
  // Roles 입력
  const rolesInput = await question('Roles (쉼표로 구분, 기본: admin): ') || 'admin';
  const roles = rolesInput.split(',').map(r => r.trim()).filter(r => r);
  
  // 유효기간 입력
  console.log('\n💡 유효기간 옵션:');
  console.log('   1. 100년 (테스트용 영구 토큰)');
  console.log('   2. 1년');
  console.log('   3. 30일');
  console.log('   4. 커스텀');
  const expiryChoice = await question('선택 (기본: 1): ') || '1';
  
  let expiresIn;
  switch(expiryChoice) {
    case '1':
      expiresIn = '876000h'; // 100년
      break;
    case '2':
      expiresIn = '365d';
      break;
    case '3':
      expiresIn = '30d';
      break;
    case '4':
      expiresIn = await question('유효기간 (예: 24h, 7d, 365d): ') || '24h';
      break;
    default:
      expiresIn = '876000h';
  }
  
  rl.close();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔨 토큰 생성 중...\n');
  
  const payload = {
    sub: userId,
    userId: userId,
    email: email,
    roles: roles,
    iss: 'almondyoung-auth',
  };
  
  const token = jwt.sign(payload, authSecret, { expiresIn });
  
  const decoded = jwt.decode(token);
  
  console.log('✅ JWT Token 생성 완료!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Token Payload:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`User ID:  ${decoded.userId}`);
  console.log(`Email:    ${decoded.email}`);
  console.log(`Roles:    ${decoded.roles.join(', ')}`);
  console.log(`Issued:   ${new Date(decoded.iat * 1000).toISOString()}`);
  console.log(`Expires:  ${new Date(decoded.exp * 1000).toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('🔑 JWT Token:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(token);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('💡 사용 예시:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n# Authorization Header 방식:');
  console.log(`curl -H "Authorization: Bearer ${token}" \\`);
  console.log('     http://localhost:3000/api/v1/files/:fileId/download\n');
  console.log('# Cookie 방식:');
  console.log(`curl --cookie "accessToken=${token}" \\`);
  console.log('     http://localhost:3000/api/v1/files/:fileId/download\n');
  console.log('# Swagger에서 사용:');
  console.log('  1. Swagger UI 접속 (http://localhost:3000/api)');
  console.log('  2. 🔒 Authorize 버튼 클릭');
  console.log('  3. 위 토큰 복사/붙여넣기');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📝 Full Decoded Payload (JSON):');
  console.log(JSON.stringify(decoded, null, 2));
  console.log('');
}

main().catch(err => {
  console.error('❌ 에러 발생:', err.message);
  rl.close();
  process.exit(1);
});

