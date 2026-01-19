import { AbstractService } from "../index";
import { CreatePaymentProfileDto, UpdatePaymentProfileDto, PaymentProfileResponse } from "./types";
export declare class PaymentProfileService extends AbstractService {
    create(profile: CreatePaymentProfileDto): Promise<PaymentProfileResponse>;
    update(memberId: string, profile: UpdatePaymentProfileDto): Promise<PaymentProfileResponse>;
    delete(memberId: string): Promise<PaymentProfileResponse>;
    get(memberId: string): Promise<PaymentProfileResponse>;
}
