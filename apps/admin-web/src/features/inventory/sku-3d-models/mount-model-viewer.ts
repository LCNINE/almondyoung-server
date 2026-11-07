import { ModelViewerElement } from '@google/model-viewer';

export function mountModelViewer(
  container: HTMLElement,
  {
    src,
    alt,
    onLoad,
    onError,
  }: { src: string; alt: string; onLoad: () => void; onError: () => void }
): () => void {
  // 업로드 GLB 는 meshopt 로 압축돼 있어 첫 모델 전에 디코더를 지정해야 한다
  ModelViewerElement.meshoptDecoderLocation =
    'https://cdn.jsdelivr.net/npm/meshoptimizer@0.24.0/meshopt_decoder.js';
  ModelViewerElement.modelCacheSize = 0;

  const viewer = document.createElement('model-viewer') as ModelViewerElement;

  viewer.setAttribute('camera-controls', '');
  viewer.setAttribute('auto-rotate', '');
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
