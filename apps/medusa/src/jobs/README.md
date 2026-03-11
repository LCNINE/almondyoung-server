# 스케줄 작업 (Scheduled Jobs)

스케줄 작업은 Medusa 애플리케이션 백그라운드에서 지정된 시간 간격으로 실행되는 함수입니다.

> 자세한 내용은 [공식 문서](https://docs.medusajs.com/learn/fundamentals/scheduled-jobs)를 참고하세요.

스케줄 작업은 `src/jobs` 디렉토리 아래에 TypeScript 또는 JavaScript 파일로 생성합니다.

## 예시

`src/jobs/hello-world.ts` 파일 생성:

```ts
import {
  MedusaContainer
} from "@medusajs/framework/types";

export default async function myCustomJob(container: MedusaContainer) {
  const productService = container.resolve("product")

  const products = await productService.listAndCountProducts();

  // 상품 데이터로 작업 수행
}

export const config = {
  name: "daily-product-report",
  schedule: "0 0 * * *", // 매일 자정
};
```

## 필수 export 항목

스케줄 작업 파일은 다음을 export 해야 합니다:

1. **핸들러 함수** (default export): 스케줄에 따라 실행될 함수
2. **config 객체**: 작업 설정
   - `name`: 작업의 고유 이름
   - `schedule`: [cron 표현식](https://crontab.guru/)
   - `numberOfExecutions` (선택): 실행 횟수 제한 (설정 시 해당 횟수 후 작업 제거)

핸들러 함수는 `container` 파라미터를 받으며, 이를 통해 서비스를 resolve 할 수 있습니다.
