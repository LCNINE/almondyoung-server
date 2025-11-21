// apps/notification/src/shared/utils/batch.utils.ts
export async function* batchProcess<T>(
    items: T[],
    batchSize: number
): AsyncGenerator<T[], void, unknown> {
    for (let i = 0; i < items.length; i += batchSize) {
        yield items.slice(i, i + batchSize);
    }
}

/**
 * 동시성 제어를 포함한 배치 처리
 * 
 * @param items 처리할 아이템 배열
 * @param processor 각 아이템을 처리하는 비동기 함수
 * @param concurrency 동시에 실행할 최대 워커 수
 * @returns 처리 결과 배열 (처리 완료 순서, 입력 순서와 다를 수 있음)
 * 
 * 주의: 결과 배열의 순서는 처리 완료 순서이며, 입력 배열 순서와 동일하지 않을 수 있습니다.
 * 입력 순서가 중요한 경우, 결과에 원본 인덱스를 포함하거나 다른 방식으로 매칭해야 합니다.
 */
export async function processBatchWithConcurrency<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = [];
    const queue = [...items]; // shallow copy
    const workers: Promise<void>[] = [];

    // 워커 함수: 큐에서 아이템을 하나씩 꺼내서 처리
    const worker = async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (item === undefined) break;

            try {
                const result = await processor(item);
                results.push(result);
            } catch (error) {
                // 에러 발생 시에도 결과 배열에 추가하지 않음
                // 필요시 여기서 에러 로깅 또는 재시도 로직 추가 가능
                throw error;
            }
        }
    };

    // 동시성 수만큼 워커 생성 및 실행
    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }

    // 모든 워커가 완료될 때까지 대기
    await Promise.all(workers);

    return results;
}