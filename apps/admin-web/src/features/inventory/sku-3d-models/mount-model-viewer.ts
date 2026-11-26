import { ModelViewerElement } from '@google/model-viewer';

export function mountModelViewer(
  container: HTMLElement,
  {
    src,
    alt,
    onLoad,
    onError,
    autoRotate = true,
    touchAction,
  }: {
    src: string;
    alt: string;
    onLoad: () => void;
    onError: () => void;
    autoRotate?: boolean;
    // pan-y: 가로 드래그는 회전, 세로 드래그는 페이지 스크롤, 두 손가락은 확대
    touchAction?: 'pan-y' | 'none';
  }
): () => void {
  // 업로드 GLB 는 meshopt 로 압축돼 있어 첫 모델 전에 디코더를 지정해야 한다
  ModelViewerElement.meshoptDecoderLocation =
    'https://cdn.jsdelivr.net/npm/meshoptimizer@0.24.0/meshopt_decoder.js';
  ModelViewerElement.modelCacheSize = 0;

  const viewer = document.createElement('model-viewer') as ModelViewerElement;

  viewer.setAttribute('camera-controls', '');

  if (autoRotate) {
    viewer.setAttribute('auto-rotate', '');
  }

  if (touchAction) {
    viewer.setAttribute('touch-action', touchAction);
  }

  viewer.setAttribute('camera-orbit', '0deg 75deg 150%');
  viewer.setAttribute('max-camera-orbit', 'auto auto 300%');
  viewer.setAttribute('alt', alt);
  viewer.style.width = '100%';
  viewer.style.height = '100%';
  viewer.addEventListener('load', onLoad);
  viewer.addEventListener('error', onError);
  viewer.src = src;
  container.append(viewer);

  return () => {
    viewer.removeEventListener('load', onLoad);
    viewer.removeEventListener('error', onError);
    viewer.src = null;
    viewer.remove();
  };
}
