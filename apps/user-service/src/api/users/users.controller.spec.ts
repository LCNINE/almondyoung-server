// import { Test, TestingModule } from '@nestjs/testing';
// import { UsersController } from './users.controller';
// import { UsersService } from './users.service';

// describe('UserController', () => {
//   let controller: UsersController;
//   let service: UsersService;

//   const mockUserService = {
//     findAll: jest.fn(),
//     findOne: jest.fn(),
//     update: jest.fn(),
//     remove: jest.fn(),
//   };

//   const mockUser = {
//     id: 1,
//     email: 'test@example.com',
//     name: 'Test User',
//   };

//   beforeEach(async () => {
//     const module: TestingModule = await Test.createTestingModule({
//       controllers: [UsersController],
//       providers: [
//         {
//           provide: UsersService,
//           useValue: mockUserService,
//         },
//       ],
//     }).compile();

//       controller = module.get<UsersController>(UsersController);
//     service = module.get<UsersService>(UsersService);
//   });

//   afterEach(() => {
//     jest.clearAllMocks();
//   });

//   it('should be defined', () => {
//     expect(controller).toBeDefined();
//   });

//   describe('findAll', () => {
//     it('should return an array of users', async () => {
//       const mockUsers = [mockUser];
//       mockUserService.findAll.mockResolvedValue(mockUsers);

//       const result = await controller.findAll();

//       expect(result).toBe(mockUsers);
//       expect(mockUserService.findAll).toHaveBeenCalled();
//     });
//   });

//   describe('findOneByUserId', () => {
//     it('should return a single user', async () => {
//       mockUserService.findOne.mockResolvedValue(mockUser);

//       const result = await controller.findOneByUserId('1');

//       expect(result).toBe(mockUser);
//       expect(mockUserService.findOne).toHaveBeenCalledWith(1);
//     });
//   });

//   describe('update', () => {
//     it('should update a user', async () => {
//       const updateDto = { name: 'Updated Name' };
//       mockUserService.update.mockResolvedValue({ ...mockUser, ...updateDto });

//       const result = await controller.update('1', updateDto);

//       expect(result).toEqual({ ...mockUser, ...updateDto });
//       expect(mockUserService.update).toHaveBeenCalledWith(1, updateDto);
//     });
//   });

//   describe('remove', () => {
//     it('should remove a user', async () => {
//       mockUserService.remove.mockResolvedValue({ success: true });

//       const result = await controller.remove('1');

//       expect(result).toEqual({ success: true });
//       expect(mockUserService.remove).toHaveBeenCalledWith(1);
//     });
//   });
// });
