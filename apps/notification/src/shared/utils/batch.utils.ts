// apps/notification/src/shared/utils/batch.utils.ts
export async function* batchProcess<T>(
    items: T[],
    batchSize: number
): AsyncGenerator<T[], void, unknown> {
    for (let i = 0; i < items.length; i += batchSize) {
        yield items.slice(i, i + batchSize);
    }
}

export async function processBatchWithConcurrency<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
        const promise = processor(item).then(result => {
            results.push(result);
        });

        executing.push(promise);

        if (executing.length >= concurrency) {
            await Promise.race(executing);
            executing.splice(
                executing.findIndex(p => p === promise),
                1
            );
        }
    }

    await Promise.all(executing);
    return results;
}