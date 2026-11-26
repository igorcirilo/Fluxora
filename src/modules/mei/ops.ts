import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "@/modules/finance/money";
import { assertBizDate, type BizDate } from "@/modules/finance/dates";
import { ACCOUNT_BANK, audit, type Ctx, type TenantState } from "@/modules/tenants/state";

/**
 * Registro MANUAL de pagamento do DAS (guia gerada no PGMEI oficial).
 * Nunca presumimos pagamento por clique: exige data, valor e referência do comprovante.
 */
export function registerDasPayment(state: TenantState, input: { competence: string; amountCents: Cents; paidOn: BizDate; proofNote: string; accountId?: string }, ctx: Ctx): TenantState {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.competence)) throw new DomainError("VALIDATION_ERROR", "Competência inválida.");
  assertCents(input.amountCents);
  assertBizDate(input.paidOn);
  if (input.paidOn > ctx.today) throw new DomainError("INVALID_DATE", "Data de pagamento no futuro.");
  const proof = input.proofNote.trim();
  if (proof.length < 3) throw new DomainError("VALIDATION_ERROR", "Informe a referência do comprovante (ex.: autenticação bancária).");
  if (state.dasPayments.some((p) => p.competence === input.competence)) throw new DomainError("VALIDATION_ERROR", "Já existe pagamento registrado para esta competência.");
  const movementId = ctx.newId("mov");
  return {
    ...state,
    dasPayments: [...state.dasPayments, { competence: input.competence, amountCents: input.amountCents, paidOn: input.paidOn, proofNote: proof }],
    movements: [
      ...state.movements,
      {
        id: movementId,
        accountId: input.accountId ?? ACCOUNT_BANK,
        date: input.paidOn,
        direction: "out",
        amountCents: input.amountCents,
        category: "expense",
        description: `DAS MEI ${input.competence}`,
      },
    ],
    audit: [...state.audit, audit(state, ctx, "das.register", "das", input.competence, proof)],
  };
}
