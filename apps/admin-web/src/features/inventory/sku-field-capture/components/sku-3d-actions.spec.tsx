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
import { CustomError } from '@/lib/api/customError';
import type {
  FieldCaptureDetailDto,
  Sku3dModelDto,
} from '@/lib/types/dto/inventory';
import { Sku3dActions } from './sku-3d-actions';

jest.mock('@/hooks/use-permission', () => ({ useCan: jest.fn() }));
jest.mock('@/lib/api/domains/files/upload.client', () => ({
  SKU_3D_MODEL_CONTEXT_ID: 'sku-3d-model',
  uploadFileToFileService: jest.fn(),
}));
jest.mock('@/lib/api/domains/inventory/sku-3d-models.client', () => ({
  sku3dModelsClient: { list: jest.fn(), register: jest.fn() },
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

function renderActions() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Sku3dActions
        skuId={detail.skuId}
        code={detail.code}
        name={detail.name}
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

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.mocked(useCan).mockReturnValue({ status: 'ready', allowed: true });
  jest.mocked(sku3dModelsClient.list).mockResolvedValue([]);
  jest.mocked(sku3dModelsClient.register).mockResolvedValue(model);
  jest.mocked(uploadFileToFileService).mockResolvedValue({
    id: 'glb-2',
    url: '/file',
    fileName: 'model.GLB',
    size: 3,
    status: 'confirmed',
    isPublic: true,
  });
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

it('uploads the normalized GLB as a private draft only on confirmation and refreshes the models', async () => {
  jest
    .mocked(sku3dModelsClient.list)
    .mockResolvedValue([{ ...model, version: 1 }]);
  renderActions();
  await screen.findByText('3D 공개 중 · v1');
  expect(screen.getByRole('button', { name: 'GLB 다시 올리기' })).toBeTruthy();

  chooseFile(new File(['glb'], 'model.GLB'));
  expect(screen.getByText('v2 비공개')).toBeTruthy();
  jest.mocked(sku3dModelsClient.list).mockResolvedValue([
    { ...model, version: 1 },
    { ...model, status: 'draft' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '올리기' }));

  await screen.findByText('3D 공개 중 · v1 · v2 비공개');
  const uploaded = jest.mocked(uploadFileToFileService).mock.calls[0];

  expect(uploaded?.[0].name).toBe('model.GLB');
  expect(uploaded?.[0].type).toBe('model/gltf-binary');
  expect(uploaded?.[1]).toEqual({
    contextId: 'sku-3d-model',
    isPublic: true,
    compress: false,
  });
  expect(sku3dModelsClient.register).toHaveBeenCalledWith('sku-1', 'glb-2');
  expect(toast.success).toHaveBeenCalledWith('v2를 비공개로 올렸어요');
});

it('shows the server error and keeps the selected file available after a rejected upload', async () => {
  jest.mocked(sku3dModelsClient.register).mockRejectedValueOnce(
    new CustomError({
      message: '등록이 거절됐어요',
      statusCode: 400,
    })
  );
  renderActions();
  await screen.findByText('3D 없음');
  chooseFile(new File(['glb'], 'model.GLB'));
  fireEvent.click(screen.getByRole('button', { name: '올리기' }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      '3D 모델을 올리지 못했어요 (등록이 거절됐어요)'
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

it('opens the 3D workshop for this SKU instead of handing photos to a local app', async () => {
  renderActions();
  await screen.findByText('3D 없음');

  const link = screen.getByRole('link', { name: '3D 작업실' });

  expect(link.getAttribute('href')).toBe(
    '/mobile/sku-3d-workshop/sku-1?back=%2Finventory%2Fsku-field-capture'
  );
  expect(screen.queryByRole('button', { name: '지피티로 가기' })).toBeNull();
  expect(document.body.innerHTML).not.toContain('codex://');
  expect(screen.getByRole('link', { name: '상세' }).getAttribute('href')).toBe(
    '/inventory/skus?code=SKU%2F1'
  );
});
