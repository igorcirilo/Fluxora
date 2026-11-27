import { LayoutDashboard, ScanLine, Receipt, Package, Users, Wallet, ShieldCheck, FileText, Settings, Briefcase } from "lucide-react";

export const NAV = [
  { href: "/painel", label: "Painel", icon: LayoutDashboard },
  { href: "/pdv", label: "PDV", icon: ScanLine },
  { href: "/vendas", label: "Vendas", icon: Receipt },
  { href: "/produtos", label: "Produtos", icon: Package },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
  { href: "/meu-mei", label: "Meu MEI", icon: ShieldCheck },
  { href: "/fiscal", label: "Fiscal", icon: FileText },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
  { href: "/contador", label: "Contador", icon: Briefcase },
] as const;

export const MOBILE_PRIMARY = ["/painel", "/pdv", "/vendas", "/financeiro"];
