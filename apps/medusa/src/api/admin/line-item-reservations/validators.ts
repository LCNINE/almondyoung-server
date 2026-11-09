import { z } from 'zod';

/** 한 번에 설정할 수 있는 줄 수. 호출자(channel-adapter)는 이 단위로 나눠 보낸다. */
export const MAX_LINE_ITEM_RESERVATION_ITEMS = 200;

export const AdminSetLineItemReservations = z.object({
  /** true 면 계획된 결과만 돌려주고 아무것도 쓰지 않는다(락도 없다). 하루 대사가 «실제로 고칠 줄»을 세는 데 쓴다. */
  dry_run: z.boolean().default(false),
  items: z
    .array(
      z.object({
        line_item_id: z.string().min(1),
        /** 판매 단위. 설정값이지 증감이 아니다. */
        quantity: z.number().int().min(0),
        /** false 면 지금 Medusa 예약 합보다 줄이는 쓰기를 하지 않고 `deferred` 로 돌려준다. */
        allow_decrease: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_LINE_ITEM_RESERVATION_ITEMS)
    // 같은 줄이 두 번 오면 어느 값이 이길지 순서에 달린다 — 받지 않는다.
    .refine((items) => new Set(items.map((item) => item.line_item_id)).size === items.length, {
      message: 'line_item_id 가 중복됐다',
    }),
});

export type AdminSetLineItemReservationsType = z.infer<typeof AdminSetLineItemReservations>;

export const MAX_LINE_ITEM_RESERVATION_PAGE = 500;

const toInt = (value: unknown) => (typeof value === 'string' && value !== '' ? Number(value) : value);

export const AdminListLineItemReservations = z.object({
  order_created_from: z.string().datetime({ offset: true }),
  after_id: z.string().min(1).optional(),
  limit: z
    .preprocess(toInt, z.number().int().min(1).max(MAX_LINE_ITEM_RESERVATION_PAGE))
    .default(MAX_LINE_ITEM_RESERVATION_PAGE),
});

export type AdminListLineItemReservationsType = z.infer<typeof AdminListLineItemReservations>;
