import { DomainError } from "@/lib/errors";
import { audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import { onlyDigits, type Customer } from "./customer";

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

/** Cadastro mínimo (LGPD: minimização). CPF e endereço não são solicitados. */
function validate(input: CustomerInput) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new DomainError("VALIDATION_ERROR", "Nome deve ter de 2 a 120 caracteres.");
  const phone = input.phone ? onlyDigits(input.phone) : "";
  if (phone && (phone.length < 10 || phone.length > 13)) throw new DomainError("VALIDATION_ERROR", "Telefone com DDD inválido.");
  const email = input.email?.trim().toLowerCase() ?? "";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("VALIDATION_ERROR", "E-mail inválido.");
  const notes = input.notes?.trim() ?? "";
  if (notes.length > 500) throw new DomainError("VALIDATION_ERROR", "Observações até 500 caracteres.");
  return { name, phone: phone || undefined, email: email || undefined, notes: notes || undefined };
}

export function createCustomer(state: TenantState, input: CustomerInput, ctx: Ctx): { state: TenantState; value: string } {
  const c: Customer = { id: ctx.newId("cli"), ...validate(input), createdAt: ctx.nowIso };
  return { state: { ...state, customers: [...state.customers, c], audit: [...state.audit, audit(state, ctx, "customer.create", "customer", c.id)] }, value: c.id };
}

export function updateCustomer(state: TenantState, id: string, input: CustomerInput, ctx: Ctx): TenantState {
  if (!state.customers.some((c) => c.id === id)) throw new DomainError("VALIDATION_ERROR", "Cliente não encontrado.");
  const v = validate(input);
  return { ...state, customers: state.customers.map((c) => (c.id === id ? { ...c, ...v } : c)), audit: [...state.audit, audit(state, ctx, "customer.update", "customer", id)] };
}
