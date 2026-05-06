export function withMypageTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 3500
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}
