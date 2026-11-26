export interface Customer {
  id: string;
  name: string;
  phone?: string; // somente dígitos com DDD
  email?: string;
  notes?: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  createdAt: string;
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Link wa.me iniciado pelo usuário — sem API paga, sem envio automático. */
export function whatsappLink(phone: string, message: string): string | null {
  const d = onlyDigits(phone);
  if (d.length < 10 || d.length > 13) return null;
  const full = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

export function formatPhone(phone?: string): string {
  if (!phone) return "";
  const d = onlyDigits(phone);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}
