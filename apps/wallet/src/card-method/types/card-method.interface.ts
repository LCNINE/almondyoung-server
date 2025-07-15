export interface IMethodService {
  register(dto: any): Promise<any>;
  delete(id: string): Promise<any>;
  getList(userId: number): Promise<any[]>;
  setDefault(id: string): Promise<any>;
}
