import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface CreateRefundAccountDto {
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  isDefault?: boolean;
}

export interface UpdateRefundAccountDto {
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  isDefault?: boolean;
}

/**
 * 사용자 환불 계좌 관리 서비스
 * - 역할: 사용자의 환불 계좌 정보를 관리합니다.
 * - 계좌 등록, 조회, 수정, 삭제 및 기본 계좌 설정 기능 제공
 */
@Injectable()
export class RefundAccountService {
  private readonly logger = new Logger(RefundAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 사용자의 환불 계좌를 등록합니다.
   */
  async createRefundAccount(data: CreateRefundAccountDto) {
    this.logger.log(
      `환불 계좌 등록: userId=${data.userId}, bankName=${data.bankName}`,
    );

    try {
      return await this.dbService.db.transaction(async (tx) => {
        // 기본 계좌로 설정하는 경우, 기존 기본 계좌를 해제
        if (data.isDefault) {
          await tx
            .update(schema.userRefundAccounts)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.userRefundAccounts.userId, data.userId),
                eq(schema.userRefundAccounts.isDefault, true),
              ),
            );
        }

        // 새 환불 계좌 생성
        const [newAccount] = await tx
          .insert(schema.userRefundAccounts)
          .values({
            id: ulid(),
            userId: data.userId,
            bankCode: data.bankCode,
            bankName: data.bankName,
            accountNumber: data.accountNumber,
            accountHolderName: data.accountHolderName,
            isDefault: data.isDefault || false,
          })
          .returning();

        this.logger.log(`환불 계좌 등록 완료: accountId=${newAccount.id}`);
        return newAccount;
      });
    } catch (error) {
      this.logger.error(`환불 계좌 등록 실패: userId=${data.userId}`, error);
      throw error;
    }
  }

  /**
   * 사용자의 모든 환불 계좌를 조회합니다.
   */
  async getUserRefundAccounts(userId: string) {
    this.logger.log(`사용자 환불 계좌 목록 조회: userId=${userId}`);

    try {
      const accounts =
        await this.dbService.db.query.userRefundAccounts.findMany({
          where: eq(schema.userRefundAccounts.userId, userId),
          orderBy: (accounts, { desc, asc }) => [
            desc(accounts.isDefault), // 기본 계좌를 먼저 표시
            asc(accounts.createdAt),
          ],
        });

      return {
        success: true,
        data: {
          accounts: accounts.map((account) => ({
            id: account.id,
            bankCode: account.bankCode,
            bankName: account.bankName,
            accountNumber: this.maskAccountNumber(account.accountNumber),
            accountHolderName: account.accountHolderName,
            isDefault: account.isDefault,
            createdAt: account.createdAt,
          })),
          totalCount: accounts.length,
        },
      };
    } catch (error) {
      this.logger.error(
        `사용자 환불 계좌 목록 조회 실패: userId=${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 특정 환불 계좌의 상세 정보를 조회합니다.
   */
  async getRefundAccount(userId: string, accountId: string) {
    this.logger.log(
      `환불 계좌 상세 조회: userId=${userId}, accountId=${accountId}`,
    );

    try {
      const account =
        await this.dbService.db.query.userRefundAccounts.findFirst({
          where: and(
            eq(schema.userRefundAccounts.id, accountId),
            eq(schema.userRefundAccounts.userId, userId),
          ),
        });

      if (!account) {
        throw new NotFoundException('환불 계좌를 찾을 수 없습니다.');
      }

      return {
        success: true,
        data: {
          id: account.id,
          bankCode: account.bankCode,
          bankName: account.bankName,
          accountNumber: account.accountNumber, // 상세 조회 시에는 전체 계좌번호 제공
          accountHolderName: account.accountHolderName,
          isDefault: account.isDefault,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        },
      };
    } catch (error) {
      this.logger.error(
        `환불 계좌 상세 조회 실패: userId=${userId}, accountId=${accountId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 환불 계좌 정보를 수정합니다.
   */
  async updateRefundAccount(
    userId: string,
    accountId: string,
    data: UpdateRefundAccountDto,
  ) {
    this.logger.log(`환불 계좌 수정: userId=${userId}, accountId=${accountId}`);

    try {
      return await this.dbService.db.transaction(async (tx) => {
        // 계좌 존재 여부 및 소유권 확인
        const existingAccount = await tx.query.userRefundAccounts.findFirst({
          where: and(
            eq(schema.userRefundAccounts.id, accountId),
            eq(schema.userRefundAccounts.userId, userId),
          ),
        });

        if (!existingAccount) {
          throw new NotFoundException('환불 계좌를 찾을 수 없습니다.');
        }

        // 기본 계좌로 변경하는 경우, 기존 기본 계좌를 해제
        if (data.isDefault && !existingAccount.isDefault) {
          await tx
            .update(schema.userRefundAccounts)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.userRefundAccounts.userId, userId),
                eq(schema.userRefundAccounts.isDefault, true),
              ),
            );
        }

        // 계좌 정보 업데이트
        const [updatedAccount] = await tx
          .update(schema.userRefundAccounts)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(schema.userRefundAccounts.id, accountId))
          .returning();

        this.logger.log(`환불 계좌 수정 완료: accountId=${accountId}`);
        return updatedAccount;
      });
    } catch (error) {
      this.logger.error(
        `환불 계좌 수정 실패: userId=${userId}, accountId=${accountId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 환불 계좌를 삭제합니다.
   */
  async deleteRefundAccount(userId: string, accountId: string) {
    this.logger.log(`환불 계좌 삭제: userId=${userId}, accountId=${accountId}`);

    try {
      return await this.dbService.db.transaction(async (tx) => {
        // 계좌 존재 여부 및 소유권 확인
        const existingAccount = await tx.query.userRefundAccounts.findFirst({
          where: and(
            eq(schema.userRefundAccounts.id, accountId),
            eq(schema.userRefundAccounts.userId, userId),
          ),
        });

        if (!existingAccount) {
          throw new NotFoundException('환불 계좌를 찾을 수 없습니다.');
        }

        // 환불 이력이 있는 계좌는 삭제 불가
        const refundHistory = await tx.query.refundEvents.findFirst({
          where: eq(schema.refundEvents.refundAccountId, accountId),
        });

        if (refundHistory) {
          throw new BadRequestException(
            '환불 이력이 있는 계좌는 삭제할 수 없습니다.',
          );
        }

        // 계좌 삭제
        await tx
          .delete(schema.userRefundAccounts)
          .where(eq(schema.userRefundAccounts.id, accountId));

        this.logger.log(`환불 계좌 삭제 완료: accountId=${accountId}`);
        return { success: true, message: '환불 계좌가 삭제되었습니다.' };
      });
    } catch (error) {
      this.logger.error(
        `환불 계좌 삭제 실패: userId=${userId}, accountId=${accountId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 사용자의 기본 환불 계좌를 조회합니다.
   */
  async getDefaultRefundAccount(userId: string) {
    this.logger.log(`기본 환불 계좌 조회: userId=${userId}`);

    try {
      const defaultAccount =
        await this.dbService.db.query.userRefundAccounts.findFirst({
          where: and(
            eq(schema.userRefundAccounts.userId, userId),
            eq(schema.userRefundAccounts.isDefault, true),
          ),
        });

      if (!defaultAccount) {
        return {
          success: false,
          message: '등록된 기본 환불 계좌가 없습니다.',
          data: null,
        };
      }

      return {
        success: true,
        data: {
          id: defaultAccount.id,
          bankCode: defaultAccount.bankCode,
          bankName: defaultAccount.bankName,
          accountNumber: defaultAccount.accountNumber,
          accountHolderName: defaultAccount.accountHolderName,
          isDefault: defaultAccount.isDefault,
        },
      };
    } catch (error) {
      this.logger.error(`기본 환불 계좌 조회 실패: userId=${userId}`, error);
      throw error;
    }
  }

  /**
   * 계좌번호를 마스킹합니다. (보안)
   */
  private maskAccountNumber(accountNumber: string): string {
    if (accountNumber.length <= 4) {
      return accountNumber;
    }

    const visibleLength = 4;
    const maskedLength = accountNumber.length - visibleLength;
    const masked = '*'.repeat(maskedLength);
    const visible = accountNumber.slice(-visibleLength);

    return masked + visible;
  }
}
