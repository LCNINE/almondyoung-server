import { YesNo } from "../types";
export interface PaymentProfileResult {
    flag: string;
    code: string;
    message: string;
}
export interface PaymentProfileLinks {
    self: string;
}
export interface CreatePaymentProfileDto {
    memberId: string;
    memberName: string;
    phone: string;
    paymentKind: "CARD";
    paymentNumber: string;
    payerName: string;
    payerNumber: string;
    validYear: string;
    validMonth: string;
    smsFlag?: YesNo;
    email?: string;
    zipcode?: string;
    address1?: string;
    address2?: string;
    joinDate?: string;
    receiptFlag?: YesNo;
    receiptNumber?: string;
    memberKind?: string;
    managerId?: string;
    memo?: string;
    paymentStartDate?: string;
    paymentEndDate?: string;
    paymentDay?: string;
    defaultAmount?: number;
    paymentCompany?: string;
    password?: string;
}
export interface UpdatePaymentProfileDto {
    memberName?: string;
    smsFlag?: YesNo;
    phone?: string;
    email?: string;
    zipcode?: string;
    address1?: string;
    address2?: string;
    joinDate?: string;
    receiptFlag?: YesNo;
    receiptNumber?: string;
    memberKind?: string;
    managerId?: string;
    memo?: string;
    paymentStartDate?: string;
    paymentEndDate?: string;
    paymentDay?: string;
    defaultAmount?: number;
    paymentCompany?: string;
    paymentKind?: "CARD";
    paymentNumber?: string;
    payerName?: string;
    payerNumber?: string;
    validYear?: string;
    validMonth?: string;
    password?: string;
}
export interface PaymentProfileResponse {
    member: {
        status: string;
        memberId: string;
        memberName: string;
        smsFlag: YesNo;
        phone: string;
        email?: string;
        zipcode?: string;
        address1?: string;
        address2?: string;
        joinDate: string;
        receiptFlag: YesNo;
        receiptNumber?: string | null;
        memberKind: string;
        managerId?: string;
        memo?: string;
        paymentStartDate: string;
        paymentEndDate: string;
        paymentDay: string;
        defaultAmount: number;
        paymentKind: string;
        paymentCompany: string;
        paymentNumber: string;
        payerName: string;
        result: PaymentProfileResult;
        links: Array<{
            rel: string;
            href: string;
        }>;
    };
}
export interface HsFmsErrorResponse {
    error: {
        code: string;
        message: string;
        details?: Record<string, string>;
    };
}
export interface PaymentProfileError {
    error: {
        code: string;
        message: string;
        details?: {
            memberId?: string;
            paymentNumber?: string;
            payerName?: string;
            payerNumber?: string;
            validYear?: string;
            validMonth?: string;
            password?: string;
        };
    };
}
