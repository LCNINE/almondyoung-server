import { CreateCardMethodDto } from '../dto/create-card-method.dto';

export function formatPhoneNumber(phone: string): string {
  return phone.replace(/-/g, '');
}

export function formatCardNumber(cardNumber: string): string {
  return cardNumber.replace(/-/g, '');
}

export function formatPayerNumber(identityNumber: string): string {
  return identityNumber.replace(/-/g, '').substring(0, 6);
}

export interface HmsApiPayload {
  memberId: string;
  memberName: string;
  phone: string;
  paymentKind: 'CARD';
  validMonth: string;
  validYear: string;
  cardNumber: string;
  cardPassword: string;
  identityNumber: string;
  customerEmail: string;
  paymentNumber: string;
  payerName: string;
  payerNumber: string;
}

export function buildHmsApiPayload(dto: CreateCardMethodDto): HmsApiPayload {
  const formattedCardNumber = formatCardNumber(dto.cardNumber);
  return {
    memberId: dto.userId.toString(),
    memberName: dto.memberName,
    phone: formatPhoneNumber(dto.phone),
    paymentKind: 'CARD',
    validMonth: dto.validMonth,
    validYear: dto.validYear,
    cardNumber: formattedCardNumber,
    cardPassword: dto.cardPassword,
    identityNumber: dto.identityNumber,
    customerEmail: dto.customerEmail,
    paymentNumber: formattedCardNumber,
    payerName: dto.payerName,
    payerNumber: formatPayerNumber(dto.identityNumber),
  };
}
