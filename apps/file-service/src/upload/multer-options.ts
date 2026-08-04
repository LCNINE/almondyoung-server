import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * 업로드 인터셉터 공통 multer 옵션.
 *
 * `defParamCharset` 이 없으면 busboy 는 multipart 파라미터(= 파트 헤더의 `filename`)를
 * **latin-1 로 읽는다** — `busboy/lib/types/multipart.js` 가 이 옵션이 없을 때
 * `nullDecoder` 를 고르고, 그건 헤더에서 나온 바이트를 그대로 문자열로 돌려준다.
 * 클라이언트(브라우저 FormData, undici FormData 모두)는 스펙대로 UTF-8 바이트를 싣기
 * 때문에, 한글 파일명이 `상품…` → `ìí…` 로 깨진 채 `file.originalname` 에 들어오고
 * 그대로 `uploads.original_name` 에 저장된다. 다운로드(`download.service.ts`)가
 * RFC 5987 `filename*=UTF-8''` 로 정확히 실어 보내도 원본이 이미 깨져 있어 소용이 없다.
 *
 * **타입에 없지만 런타임에는 전달된다.** Nest 의 `MulterOptions` 는 손으로 적은 부분
 * 집합이라 이 필드가 빠져 있는데, `FileInterceptor` 는 받은 옵션을 그대로
 * `multer({ ...options })` 로 펼치고(@nestjs/platform-express 의 file.interceptor.js)
 * multer 2.x 는 이를 busboy 로 넘긴다(multer/lib/make-middleware.js). 실제 multer 타입
 * (`@types/multer`)에는 정식으로 선언돼 있다. `as` 캐스팅 대신 교차 타입으로 필드를
 * 되살려 타입 안전성을 유지한다.
 *
 * 회귀는 `multer-options.spec.ts` 가 실제 multipart 요청으로 잡는다.
 */
export const UPLOAD_MULTER_OPTIONS: MulterOptions & { defParamCharset: string } = {
  defParamCharset: 'utf8',
};
