import type { Cents } from "@/modules/finance/money";
import type { BizDate } from "@/modules/finance/dates";

export type PaymentMethod = "dinheiro" | "pix" | "debito" | "credito" | "fiado";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  debito: "Débito",
  credito: "Crédito",
  fiado: "Fiado / a prazo",
};

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: Cents;
  unitCostCents: Cents;
  totalCents: Cents;
}

export interface SalePayment {
  method: PaymentMethod;
  amountCents: Cents; // valor aplicado à venda (sem troco)
}

export interface Sale {
  id: string;
  number: number;
  idempotencyKey: string;
  createdAt: string;
  date: BizDate; // competência
  customerId?: string;
  items: SaleItem[];
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  payments: SalePayment[];
  cashTenderedCents: Cents;
  changeCents: Cents;
  status: "concluida" | "devolvida";
  cashSessionId?: string;
  returnedAt?: string;
  note?: string;
}

export interface CashSession {
  id: string;
  openedAt: string;
  openedOn: BizDate;
  openingCountCents: Cents;
  closedAt?: string;
  countedCents?: Cents;
  expectedCents?: Cents;
  differenceCents?: Cents;
}
