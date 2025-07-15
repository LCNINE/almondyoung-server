/**
 * 결제수단 서비스 공통 인터페이스
 */
export interface IMethodService<TCreateDto, TUpdateDto, TResponseDto> {
  register(dto: TCreateDto): Promise<TResponseDto>;
  update(id: string, dto: TUpdateDto): Promise<TResponseDto>;
  delete(id: string): Promise<void>;
  getList(userId: number): Promise<TResponseDto[]>;
  setDefault(id: string): Promise<void>;
}
