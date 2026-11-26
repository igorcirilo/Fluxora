/**
 * Erros de domínio com código estável. Mensagens não carregam dados pessoais.
 */
export type DomainErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "INVALID_QUANTITY"
  | "EMPTY_CART"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "INSUFFICIENT_STOCK"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  | "PAYMENT_MISMATCH"
  | "CHANGE_WITHOUT_CASH"
  | "CREDIT_REQUIRES_CUSTOMER"
  | "CASH_SESSION_CLOSED"
  | "CASH_SESSION_ALREADY_OPEN"
  | "SALE_NOT_FOUND"
  | "SALE_ALREADY_RETURNED"
  | "SETTLEMENT_EXCEEDS_BALANCE"
  | "TITLE_NOT_FOUND"
  | "REVERSAL_EXCEEDS_ORIGINAL"
  | "REVERSAL_ORIGINAL_NOT_FOUND"
  | "TRANSFER_SAME_ACCOUNT"
  | "RULE_NOT_FOUND"
  | "REGIME_NOT_SUPPORTED"
  | "BEFORE_OPENING_DATE"
  | "FISCAL_PROVIDER_NOT_CONFIGURED"
  | "BILLING_PROVIDER_NOT_CONFIGURED"
  | "TENANT_ACCESS_DENIED"
  | "VALIDATION_ERROR";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
