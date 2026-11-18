// probe-image-size 7.x 는 타입을 싣지 않는다. 버퍼에서 크기만 읽는 sync 진입점만 선언한다.
declare module 'probe-image-size/sync' {
  function probeImageSize(buffer: Buffer): { width: number; height: number } | null;
  export = probeImageSize;
}
