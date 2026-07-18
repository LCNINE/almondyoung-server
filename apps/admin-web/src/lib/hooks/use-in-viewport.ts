import { RefObject, useEffect, useState } from 'react';

interface UseInViewportOptions {
  /**
   * IntersectionObserver threshold.
   * 0 = 일부라도 보이면 true, 1 = 요소가 완전히 보일 때만 true.
   */
  threshold?: number;
  /** false 면 관찰을 멈추고 항상 false 를 반환한다. */
  enabled?: boolean;
}

/**
 * ref 로 지정한 요소가 뷰포트 안에 보이는지 추적한다.
 * 스크롤 컨테이너(`overflow-y-auto` main 등) 안에서도 동작한다.
 * threshold 1 을 주면 "완전히 보이는지" 를 판별한다.
 */
export function useInViewport(
  ref: RefObject<Element | null>,
  { threshold = 0, enabled = true }: UseInViewportOptions = {}
): boolean {
  const [inViewport, setInViewport] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') {
      setInViewport(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInViewport(entry.isIntersecting);
      },
      { threshold }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold, enabled]);

  return inViewport;
}
