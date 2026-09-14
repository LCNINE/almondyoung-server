import { randomUUID } from 'crypto';
import { ProductAiImageService } from './product-ai-image.service';

const fileId = randomUUID();
const auth = { cookie: 'accessToken=test-user-token' };
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const metadata = {
  id: fileId,
  originalName: '상품.png',
  mimeType: 'image/png',
  size: png.length,
  contextId: 'product-ai-image',
  status: 'active',
  isPublic: false,
};
describe('ProductAiImageService', () => {
  const images = new ProductAiImageService();
  afterEach(() => jest.restoreAllMocks());
  it('파일 권한 거부 시 저장소 URL이나 이미지에 접근하지 않는다', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
    await expect(images.load([fileId], auth, new AbortController().signal)).rejects.toThrow('접근');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('상품 저장 시 원본을 변경하지 않고 인증된 공개 상품용 파일로 복사한다', async () => {
    const newId = randomUUID();
    jest
      .spyOn(images, 'load')
      .mockResolvedValue(new Map([[fileId, `data:image/png;base64,${png.toString('base64')}`]]));
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        Response.json({ id: newId, url: 'https://storage.example/product.png', status: 'active', isPublic: true }),
      );
    const result = await images.copyForProduct([fileId], auth, new AbortController().signal);
    expect(result.get(fileId)?.fileId).toBe(newId);
    const init = request.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Cookie: auth.cookie });
    const form = init.body as FormData;
    expect(form.get('contextId')).toBe('product-image');
    expect(form.get('isPublic')).toBe('true');
    expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    );
  });
  it('사용자 인증은 파일 서비스에만 전달하고 이미지 바이트를 읽는다', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://storage.example/image.png' }))
      .mockResolvedValueOnce(new Response(png));
    const loaded = await images.load([fileId], auth, new AbortController().signal);
    expect(loaded.get(fileId)).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(request.mock.calls[0][1]?.headers).toEqual({ Cookie: auth.cookie });
    expect(request.mock.calls[2][1]?.headers).toBeUndefined();
  });
  it.each([
    { contextId: 'business-verification-file' },
    { isPublic: true },
    { size: 6 * 1024 * 1024 },
    { mimeType: 'image/svg+xml' },
  ])('허용하지 않은 파일 메타데이터는 거부한다: %j', async (override) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ ...metadata, ...override }));
    await expect(images.inspect([fileId], auth)).rejects.toThrow('비공개');
  });
  it('이미지로 위장한 파일의 실제 바이트를 거부한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://storage.example/image.png' }))
      .mockResolvedValueOnce(new Response('not an image'));
    await expect(images.load([fileId], auth, new AbortController().signal)).rejects.toThrow('일치하지');
  });
  it('신고된 크기보다 큰 스트림을 조기에 중단한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://storage.example/image.png' }))
      .mockResolvedValueOnce(new Response(new Uint8Array(30)));
    await expect(images.load([fileId], auth, new AbortController().signal)).rejects.toThrow('크기');
  });
});
