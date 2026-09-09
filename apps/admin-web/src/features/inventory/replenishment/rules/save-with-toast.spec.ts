import { CustomError } from '@/lib/api/customError';
import { toast } from 'sonner';
import { runWithToast } from './save-with-toast';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const success = jest.mocked(toast.success);
const error = jest.mocked(toast.error);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runWithToast', () => {
  it('성공하면 성공 토스트 + onSuccess 1회', async () => {
    const onSuccess = jest.fn();
    await runWithToast({
      run: () => Promise.resolve('ok'),
      success: '저장했습니다.',
      failure: '저장에 실패했습니다.',
      onSuccess,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('저장했습니다.');
    expect(error).not.toHaveBeenCalled();
  });

  /**
   * 이 태스크에서 **데이터 손실을 막는 유일한 코드**다. `run().then(onSuccess)` 나
   * 호출처의 `save(...).then(리셋)` 로 되돌아가면 400 · 409 를 받고도 사람이 방금 친
   * 입력이 전부 지워진다. 그 회귀는 이 단언에서만 빨개진다.
   */
  it('실패하면 onSuccess 를 부르지 않는다 — 입력을 지우지 않는다', async () => {
    const onSuccess = jest.fn();
    await runWithToast({
      run: () =>
        Promise.reject(
          new CustomError({ message: '이미 있는 경로입니다', statusCode: 409 })
        ),
      success: '저장했습니다.',
      failure: '저장에 실패했습니다.',
      onSuccess,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    // 서버 메시지를 그대로 쓴다 (CustomError.message)
    expect(error).toHaveBeenCalledWith('이미 있는 경로입니다');
  });

  it('서버 메시지가 없으면 폴백 문구로 실패 토스트', async () => {
    await runWithToast({
      run: () => Promise.reject(new Error('network down')),
      success: '지웠습니다.',
      failure: '삭제에 실패했습니다.',
    });
    expect(error).toHaveBeenCalledWith('삭제에 실패했습니다.');
  });

  it('onSuccess 없이도 성공 토스트만 낸다', async () => {
    await runWithToast({
      run: () => Promise.resolve(),
      success: '저장했습니다.',
      failure: '저장에 실패했습니다.',
    });
    expect(success).toHaveBeenCalledWith('저장했습니다.');
    expect(error).not.toHaveBeenCalled();
  });

  // `onSuccess` 가 `try` 안에 있으면 상태 갱신이 던졌을 때 **성공이 「저장에 실패했습니다」로
  // 뒤집힌다** — 서버에는 이미 저장된 뒤라 사람이 다시 눌러 중복 저장을 하게 된다.
  it('onSuccess 가 던져도 성공을 실패로 뒤집지 않는다', async () => {
    await expect(
      runWithToast({
        run: () => Promise.resolve(),
        success: '저장했습니다.',
        failure: '저장에 실패했습니다.',
        onSuccess: () => {
          throw new Error('setState boom');
        },
      })
    ).rejects.toThrow('setState boom');
    expect(success).toHaveBeenCalledWith('저장했습니다.');
    expect(error).not.toHaveBeenCalled();
  });
});
