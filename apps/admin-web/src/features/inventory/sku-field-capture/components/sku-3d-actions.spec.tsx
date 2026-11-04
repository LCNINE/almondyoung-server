/** @jest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-permission';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { sku3dModelsClient } from '@/lib/api/domains/inventory/sku-3d-models.client';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import { CustomError } from '@/lib/api/customError';
import type {
  FieldCaptureDetailDto,
  Sku3dModelDto,
} from '@/lib/types/dto/inventory';
import { fieldCaptureKeys } from '../field-capture-model';
import { Sku3dActions } from './sku-3d-actions';

jest.mock('@/hooks/use-permission', () => ({ useCan: jest.fn() }));
jest.mock('@/lib/api/domains/files/upload.client', () => ({
  SKU_3D_MODEL_CONTEXT_ID: 'sku-3d-model',
  uploadFileToFileService: jest.fn(),
}));
jest.mock('@/lib/api/domains/inventory/sku-3d-models.client', () => ({
  sku3dModelsClient: { list: jest.fn(), register: jest.fn() },
}));
jest.mock('@/lib/api/domains/inventory/sku-field-capture.client', () => ({
  skuFieldCaptureClient: { getDetail: jest.fn() },
}));
jest.mock('@/const/api-const', () => ({
  FILE_SERVICE_BASE_URL: '/api/proxy/file',
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const detail: FieldCaptureDetailDto = {
  skuId: 'sku-1',
  code: 'SKU/1',
  name: '테스트 상품',
  imageUrl: null,
  positionCode: null,
  packageWidthMm: 120,
  packageLengthMm: 80,
  packageHeightMm: 45,
  packageWeightG: 210,
  barcodes: [],
  photos: [2, 1].map((i) => ({
    id: `p${i}`,
    fileId: `f${i}`,
    sortOrder: i,
    takenByLabel: '작업자',
    createdAt: '2026-11-03T00:00:00Z',
  })),
  completion: null,
};
const model: Sku3dModelDto = {
  id: 'model-2',
  skuId: 'sku-1',
  version: 2,
  glbFileId: 'glb-2',
  status: 'approved',
  createdAt: '2026-11-03T00:00:00Z',
};
let queryClient: QueryClient;

function renderActions(dims = detail) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Sku3dActions
        skuId={detail.skuId}
        code={detail.code}
        name={detail.name}
        dims={dims}
      />
    </QueryClientProvider>
  );
}

function chooseFile(file: File) {
  const input = document.querySelector('input[type="file"]');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Missing file input');
  }

  fireEvent.change(input, { target: { files: [file] } });

  return input;
}

function stubPhotoDownloads() {
  const clicked: { href: string; download: string }[] = [];
  const fetchPhoto = jest.fn(async () => ({
    ok: true,
    blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
  }));

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchPhoto,
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(() => 'blob:photo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push({ href: this.href, download: this.download });
  });

  return { clicked, fetchPhoto };
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.mocked(useCan).mockReturnValue({ status: 'ready', allowed: true });
  jest.mocked(sku3dModelsClient.list).mockResolvedValue([]);
  jest.mocked(sku3dModelsClient.register).mockResolvedValue(model);
  jest.mocked(skuFieldCaptureClient.getDetail).mockResolvedValue(detail);
  jest.mocked(uploadFileToFileService).mockResolvedValue({
    id: 'glb-2',
    url: '/file',
    fileName: 'model.GLB',
    size: 3,
    status: 'confirmed',
    isPublic: true,
  });
  window.localStorage.setItem(
    'sku-field-capture:downloads-folder',
    '/Users/tester/Downloads'
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('does not upload before confirmation or after cancellation, and resets rejected files', async () => {
  renderActions();
  await screen.findByText('3D 없음');

  fireEvent.click(screen.getByRole('button', { name: 'GLB 업로드' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();

  const input = chooseFile(new File(['bad'], 'model.gltf'));

  expect(toast.error).toHaveBeenCalledWith('GLB 파일만 올릴 수 있어요');
  expect(input.value).toBe('');
  expect(screen.queryByRole('alertdialog')).toBeNull();

  chooseFile(new File(['glb'], 'model.GLB'));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(uploadFileToFileService).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(uploadFileToFileService).not.toHaveBeenCalled();
  expect(sku3dModelsClient.register).not.toHaveBeenCalled();
});

it('publishes the normalized GLB only on confirmation and refreshes the models', async () => {
  jest
    .mocked(sku3dModelsClient.list)
    .mockResolvedValue([{ ...model, version: 1 }]);
  renderActions();
  await screen.findByText('3D 공개 중 · v1');
  expect(screen.getByRole('button', { name: 'GLB 다시 올리기' })).toBeTruthy();

  chooseFile(new File(['glb'], 'model.GLB'));
  expect(screen.getByText('v1 → v2')).toBeTruthy();
  jest.mocked(sku3dModelsClient.list).mockResolvedValue([model]);
  fireEvent.click(screen.getByRole('button', { name: '공개하기' }));

  await screen.findByText('3D 공개 중 · v2');
  const uploaded = jest.mocked(uploadFileToFileService).mock.calls[0];

  expect(uploaded?.[0].name).toBe('model.GLB');
  expect(uploaded?.[0].type).toBe('model/gltf-binary');
  expect(uploaded?.[1]).toEqual({
    contextId: 'sku-3d-model',
    isPublic: true,
    compress: false,
  });
  expect(sku3dModelsClient.register).toHaveBeenCalledWith('sku-1', 'glb-2');
  expect(toast.success).toHaveBeenCalledWith('v2 을 공개했어요');
});

it('shows the server error and keeps the selected file available after a rejected publication', async () => {
  jest.mocked(sku3dModelsClient.register).mockRejectedValueOnce(
    new CustomError({
      message: '등록이 거절됐어요',
      statusCode: 400,
    })
  );
  renderActions();
  await screen.findByText('3D 없음');
  chooseFile(new File(['glb'], 'model.GLB'));
  fireEvent.click(screen.getByRole('button', { name: '공개하기' }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      '3D 모델을 공개하지 못했어요 (등록이 거절됐어요)'
    )
  );
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(toast.success).not.toHaveBeenCalled();
});

it.each(['loading', 'error', 'denied'])(
  'disables upload when permission is %s',
  async (state) => {
    jest
      .mocked(useCan)
      .mockReturnValue(
        state === 'loading'
          ? { status: 'loading' }
          : state === 'error'
            ? { status: 'error' }
            : { status: 'ready', allowed: false }
      );
    renderActions();
    await screen.findByText('3D 없음');

    expect(
      screen
        .getByRole('button', { name: 'GLB 업로드' })
        .hasAttribute('disabled')
    ).toBe(true);
  }
);

it.each([0, null])(
  'disables handoff for a missing measurement (%s) and encodes the detail link',
  async (value) => {
    renderActions({ ...detail, packageWidthMm: value });
    await screen.findByText('3D 없음');

    expect(
      screen
        .getByRole('button', { name: '지피티로 가기' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByRole('link', { name: '상세' }).getAttribute('href')
    ).toBe('/inventory/skus?code=SKU%2F1');
  }
);

it('blocks handoff when the fetched detail no longer has photos', async () => {
  jest
    .mocked(skuFieldCaptureClient.getDetail)
    .mockResolvedValue({ ...detail, photos: [] });
  renderActions();
  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('찍은 사진이 없어요')
  );
  expect(toast.success).not.toHaveBeenCalled();
});

it('opens the ChatGPT app with the photo folder and prompt, then downloads the photos in order', async () => {
  const { clicked, fetchPhoto } = stubPhotoDownloads();

  renderActions();
  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));

  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      'ChatGPT 앱을 열고 사진 2장을 내려받았어요',
      { description: '앱에서 전송을 눌러 주세요' }
    )
  );

  const app = new URL(clicked[0]!.href);

  expect(app.protocol).toBe('codex:');
  expect(app.searchParams.get('path')).toBe('/Users/tester/Downloads');
  expect(app.searchParams.get('prompt')).toContain(
    '이 폴더의 SKU/1-1 ~ SKU/1-2 상품 사진 2장'
  );
  expect(app.searchParams.get('prompt')).toContain('가로: 120mm');
  expect(fetchPhoto.mock.calls).toEqual(
    [1, 2].map((i) => [
      `${window.location.origin}/api/proxy/file/files/public/f${i}`,
      { cache: 'no-store' },
    ])
  );
  expect(clicked.slice(1).map(({ download }) => download)).toEqual([
    'SKU/1-1.jpeg',
    'SKU/1-2.jpeg',
  ]);
});

it('asks for the downloads folder once and remembers it', async () => {
  window.localStorage.clear();
  const ask = jest
    .spyOn(window, 'prompt')
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(' /Users/me/Downloads ');
  stubPhotoDownloads();
  renderActions();

  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));
  expect(skuFieldCaptureClient.getDetail).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());

  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));

  expect(ask).toHaveBeenCalledTimes(2);
  expect(
    window.localStorage.getItem('sku-field-capture:downloads-folder')
  ).toBe('/Users/me/Downloads');
});

it('refetches cached detail and hands off the fresh measurements and photos', async () => {
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime: 300_000 },
  });
  queryClient.setQueryData(fieldCaptureKeys.detail(detail.skuId), detail);
  jest.mocked(skuFieldCaptureClient.getDetail).mockResolvedValue({
    ...detail,
    packageWidthMm: 240,
  });
  const { clicked } = stubPhotoDownloads();
  renderActions();

  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());

  expect(skuFieldCaptureClient.getDetail).toHaveBeenCalledTimes(1);
  expect(new URL(clicked[0]!.href).searchParams.get('prompt')).toContain(
    '가로: 240mm'
  );
});

it('reports a failed photo download', async () => {
  const { fetchPhoto } = stubPhotoDownloads();

  fetchPhoto.mockResolvedValueOnce({
    ok: false,
    blob: async () => new Blob([]),
  });
  renderActions();
  fireEvent.click(screen.getByRole('button', { name: '지피티로 가기' }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('ChatGPT 앱으로 넘기지 못했어요')
  );
  expect(toast.success).not.toHaveBeenCalled();
});
