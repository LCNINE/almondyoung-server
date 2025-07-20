// import { Test, TestingModule } from '@nestjs/testing';
// import { PaymentMethodController } from './payment-method.controller';
// import { PaymentMethodService } from './services/payment-method.service';
// import {
//   CreatePaymentMethodDto,
//   UpdatePaymentMethodDto,
//   VerifyPaymentMethodDto,
// } from '../shared/zod';

// describe('PaymentMethodController', () => {
//   let controller: PaymentMethodController;
//   const mockService: jest.Mocked<PaymentMethodService> = {
//     create: jest.fn(),
//     update: jest.fn(),
//     deactivate: jest.fn(),
//     verifyStatus: jest.fn(),
//   } as any;

//   beforeEach(async () => {
//     const module: TestingModule = await Test.createTestingModule({
//       controllers: [PaymentMethodController],
//       providers: [{ provide: PaymentMethodService, useValue: mockService }],
//     }).compile();

//     controller = module.get(PaymentMethodController);
//     jest.clearAllMocks();
//   });

//   it('should be defined', () => {
//     expect(controller).toBeDefined();
//   });

//   it('create calls service.create and returns result', async () => {
//     const dto: CreatePaymentMethodDto = {
//       userId: 'u1',
//       methodType: 'BNPL',
//       methodName: 'BNPL',
//       institutionCode: 'ALM',
//       isDefault: true,
//     } as any;
//     mockService.create.mockResolvedValue({
//       id: 'pm1',
//       status: 'PENDING',
//     } as any);

//     const result = await controller.create(dto);
//     expect(mockService.create).toHaveBeenCalledWith(dto);
//     expect(result).toEqual({ id: 'pm1', status: 'PENDING' });
//   });

//   it('update calls service.update and returns result', async () => {
//     const updateDto: UpdatePaymentMethodDto = {
//       methodName: 'New Name',
//     } as any;
//     mockService.update.mockResolvedValue({
//       id: 'pm1',
//       methodName: 'New Name',
//     } as any);

//     const res = await controller.update('pm1', updateDto);
//     expect(mockService.update).toHaveBeenCalledWith('pm1', updateDto);
//     expect(res).toEqual({ id: 'pm1', methodName: 'New Name' });
//   });

//   it('verify calls service.verifyStatus', async () => {
//     const verifyDto: VerifyPaymentMethodDto = { status: 'ACTIVE' } as any;
//     mockService.verifyStatus.mockResolvedValue({
//       id: 'pm1',
//       status: 'ACTIVE',
//     } as any);

//     const res = await controller.verify('pm1', verifyDto);
//     expect(mockService.verifyStatus).toHaveBeenCalledWith('pm1', 'ACTIVE');
//     expect(res).toEqual({ id: 'pm1', status: 'ACTIVE' });
//   });

//   it('deactivate calls service.deactivate', async () => {
//     mockService.deactivate.mockResolvedValue({
//       id: 'pm1',
//       status: 'INACTIVE',
//     } as any);

//     const res = await controller.deactivate('pm1');
//     expect(mockService.deactivate).toHaveBeenCalledWith('pm1');
//     expect(res).toEqual({ id: 'pm1', status: 'INACTIVE' });
//   });
// });
