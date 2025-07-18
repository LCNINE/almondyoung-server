import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from '../shared/zod/wallet.dto';

describe('InvoiceController', () => {
  let controller: InvoiceController;
  const mockInvoiceService: jest.Mocked<InvoiceService> = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    updateStatus: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        {
          provide: InvoiceService,
          useValue: mockInvoiceService,
        },
      ],
    }).compile();

    controller = module.get<InvoiceController>(InvoiceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create should call service.create and return result', async () => {
    const dto: CreateInvoiceDto = {
      userId: 'user1',
      amount: 1000,
      currency: 'KRW',
      invoiceType: 'PRODUCT',
      description: 'test',
    } as any;
    (mockInvoiceService.create as jest.Mock).mockResolvedValue({
      id: 1,
      ...dto,
    });

    const result = await controller.create(dto);

    expect(mockInvoiceService.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 1, ...dto });
  });
});
