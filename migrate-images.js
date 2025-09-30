#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 소스와 타겟 디렉토리 설정
const sourceDir = path.join(__dirname, '크롤링데이터', 'images');
const targetDir = path.join(__dirname, 'apps', 'pim', 'images');

// 타겟 디렉토리가 없으면 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 이미지 파일 이동 함수
function migrateImages() {
  try {
    console.log('🚀 이미지 파일 마이그레이션 시작...');
    console.log(`📂 소스: ${sourceDir}`);
    console.log(`📁 타겟: ${targetDir}`);

    // 소스 디렉토리의 모든 파일 읽기
    const files = fs.readdirSync(sourceDir);
    let copiedCount = 0;
    let skippedCount = 0;

    files.forEach((file) => {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      // 파일인지 확인 (디렉토리 제외)
      if (fs.statSync(sourcePath).isFile()) {
        // 이미지 파일 확장자 확인
        const ext = path.extname(file).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          try {
            // 파일이 이미 존재하는지 확인
            if (fs.existsSync(targetPath)) {
              console.log(`⚠️  이미 존재함: ${file}`);
              skippedCount++;
            } else {
              // 파일 복사
              fs.copyFileSync(sourcePath, targetPath);
              console.log(`✅ 복사 완료: ${file}`);
              copiedCount++;
            }
          } catch (error) {
            console.error(`❌ 복사 실패: ${file} - ${error.message}`);
          }
        }
      }
    });

    console.log('\n📊 마이그레이션 완료!');
    console.log(`✅ 복사된 파일: ${copiedCount}개`);
    console.log(`⚠️  건너뛴 파일: ${skippedCount}개`);
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
  }
}

// 실행
migrateImages();
