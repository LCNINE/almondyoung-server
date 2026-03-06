interface CustomErrorInterface {
  message: string;
  statusCode: number;
  response?: any;
}

export class CustomError extends Error {
  statusCode: number;
  response?: any;

  constructor({ message, statusCode, response }: CustomErrorInterface) {
    super(message); // 부모 클래스인 Error의 생성자를 호출하여 message를 설정합니다.
    this.name = 'CustomError'; // 에러의 이름을 지정합니다.
    this.statusCode = statusCode; // HTTP 상태 코드를 포함시킵니다.
    this.response = response; // 추가적인 응답 데이터를 포함시킵니다.
  }
}

/**
 * 에러가 CustomError 인스턴스인지 확인하는 타입 가드
 * @param error - 확인할 에러 객체
 * @returns CustomError 여부
 */
export function isCustomError(error: any): error is CustomError {
  return (
    error instanceof CustomError ||
    (error &&
      typeof error.statusCode === 'number' &&
      typeof error.message === 'string')
  );
}
