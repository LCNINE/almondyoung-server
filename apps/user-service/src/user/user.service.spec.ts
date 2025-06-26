import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all users message', () => {
      const result = service.findAll();
      expect(result).toBe('This action returns all user');
    });
  });

  describe('findOne', () => {
    it('should return a single user message', () => {
      const userId = 1;
      const result = service.findOne(userId);
      expect(result).toBe(`This action returns a #${userId} user`);
    });
  });

  describe('update', () => {
    it('should return an update message', () => {
      const userId = 1;
      const updateUserDto: UpdateUserDto = { name: 'Updated Name' };
      const result = service.update(userId, updateUserDto);
      expect(result).toBe(`This action updates a #${userId} user`);
    });
  });

  describe('remove', () => {
    it('should return a remove message', () => {
      const userId = 1;
      const result = service.remove(userId);
      expect(result).toBe(`This action removes a #${userId} user`);
    });
  });

  describe('validateUniqueEmail', () => {
    it('should return a validate message', () => {
      const email = 'test@test.com';
      const result = service.validateUniqueEmail(email);
      expect(result).toBe(`This action validates a #${email} email`);
    });
  });
  describe('validateUniqueUserId', () => {
    it('should return a validate message', () => {
      const userId = 'test';
      const result = service.validateUniqueUserId(userId);
      expect(result).toBe(`This action validates a #${userId} userId`);
    });
  });
});
