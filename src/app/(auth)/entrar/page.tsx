import type { Metadata } from "next";
import { EntryScreen } from "./entry-screen";

export const metadata: Metadata = { title: "Entrar na demonstração" };

export default function EntrarPage() {
  return <EntryScreen />;
}
