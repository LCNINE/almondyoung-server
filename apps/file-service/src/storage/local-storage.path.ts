import { ConfigService } from '@nestjs/config';
import * as path from 'path';

/**
 * LOCAL 스토리지 루트.
 *
 * 쓰는 쪽(`LocalStorageProvider`)과 읽는 쪽(`LocalFileController`)이 **반드시 같은 값**을
 * 봐야 해서 각자 join 하지 않고 여기 하나만 둔다. 갈라지면 업로드는 성공하는데 다운로드만
 * 404 가 되어, 원인이 파일이 아니라 경로라는 걸 알아채기 어렵다.
 */
export function localUploadsDir(config: ConfigService): string {
  return config.get<string>('LOCAL_STORAGE_DIR') ?? path.join(process.cwd(), 'uploads');
}

/**
 * `key` 를 루트 안쪽 절대경로로 푼다. 루트를 벗어나면 `null`.
 *
 * key 는 DB 의 `filePath` 에서 오지만 서빙 라우트에는 **인증이 없다**(S3 서명 URL 을
 * 대체하는 자리라 core 도 브라우저도 토큰 없이 GET 한다). 그래서 경로 탈출은 호출부가
 * 아니라 여기서 막는다 — `path.resolve` 가 `..` 를 접어버린 뒤 루트 접두사를 확인한다.
 */
export function resolveWithinUploadsDir(baseDir: string, key: string): string | null {
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
