# 커스텀 구독자(Subscribers)

구독자는 Medusa 애플리케이션에서 발생하는 이벤트를 처리합니다.

> 구독자에 대해 더 자세히 알아보려면 [이 문서](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers)를 참고하세요.

구독자는 `src/subscribers` 디렉토리 아래에 TypeScript 또는 JavaScript 파일로 생성됩니다.

예를 들어, 다음과 같은 내용으로 `src/subscribers/product-created.ts` 파일을 생성할 수 있습니다:

```ts
import { type SubscriberConfig } from '@medusajs/framework';

// 구독자 함수
export default async function productCreateHandler() {
  console.log('상품이 생성되었습니다');
}

// 구독자 설정
export const config: SubscriberConfig = {
  event: 'product.created',
};
```

구독자 파일은 다음을 반드시 내보내야 합니다:

- 구독자 함수: 연결된 이벤트가 발생할 때마다 실행되는 비동기 함수
- 설정 객체: 이 구독자가 감시할 이벤트를 정의하는 객체

## 구독자 매개변수

구독자는 다음 속성을 가진 객체를 받습니다:

- `event`: 이벤트의 상세 정보를 담고 있는 객체. `data` 속성에는 이벤트의 데이터 페이로드가 포함됩니다.
- `container`: Medusa 컨테이너. 모듈의 메인 서비스와 다른 등록된 리소스를 가져오는 데 사용됩니다.

```ts
import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';

export default async function productCreateHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = data.id;

  const productModuleService = container.resolve('product');

  const product = await productModuleService.retrieveProduct(productId);

  console.log(`상품 ${product.title}이(가) 생성되었습니다`);
}

export const config: SubscriberConfig = {
  event: 'product.created',
};
```
