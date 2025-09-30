const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PRODUCTS_JSON_PATH = path.join(
  __dirname,
  '크롤링데이터',
  'products.json',
);
const TARGET_IMAGE_DIR = path.join(__dirname, 'apps', 'pim', 'images');

async function downloadImage(url, filepath) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });
    return new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(filepath))
        .on('error', reject)
        .once('close', () => resolve(filepath));
    });
  } catch (error) {
    throw new Error(`Failed to download ${url}: ${error.message}`);
  }
}

async function downloadThumbnails() {
  console.log('🚀 썸네일 이미지 다운로드 시작...');
  await fs.promises.mkdir(TARGET_IMAGE_DIR, { recursive: true });

  const productsData = JSON.parse(fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8'));
  console.log(`📊 총 ${productsData.length}개 상품 발견`);

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (const product of productsData) {
    // 썸네일이 객체 형태인 경우
    let thumbnailUrl = null;
    let filename = null;

    if (product.thumbnail) {
      if (typeof product.thumbnail === 'object') {
        // 객체 형태: { originalUrl, localPath, filename }
        thumbnailUrl = product.thumbnail.originalUrl;
        filename = product.thumbnail.filename;
      } else if (typeof product.thumbnail === 'string') {
        // 문자열 형태: URL
        thumbnailUrl = product.thumbnail;
        filename = path.basename(new URL(thumbnailUrl).pathname);
      }
    }

    if (!thumbnailUrl) {
      console.log(`⚠️  썸네일 없음: ${product.title}`);
      product.localThumbnailPath = null;
      continue;
    }

    const localPath = path.join(TARGET_IMAGE_DIR, filename);
    const relativeLocalPath = `/images/${filename}`; // PIM 서버에서 접근할 URL 경로

    console.log(`📥 다운로드 중: ${product.title}`);

    if (fs.existsSync(localPath)) {
      console.log(`✅ 이미 존재: ${filename}`);
      skippedCount++;
      product.localThumbnailPath = relativeLocalPath;
    } else {
      try {
        await downloadImage(thumbnailUrl, localPath);
        console.log(`✅ 다운로드 완료: ${filename}`);
        product.localThumbnailPath = relativeLocalPath;
        successCount++;
      } catch (error) {
        console.error(`❌ 다운로드 실패 (${product.title}): ${error.message}`);
        failCount++;
        product.localThumbnailPath = null; // 실패 시 null 처리
      }
    }
  }

  fs.writeFileSync(
    PRODUCTS_JSON_PATH,
    JSON.stringify(productsData, null, 2),
    'utf8',
  );
  console.log('\n📊 다운로드 완료!');
  console.log(`✅ 다운로드 성공: ${successCount}개`);
  console.log(`⚠️  건너뛴 파일: ${skippedCount}개`);
  console.log(`❌ 실패: ${failCount}개`);
  console.log('\n✅ products.json 업데이트 완료!');
}

downloadThumbnails();
