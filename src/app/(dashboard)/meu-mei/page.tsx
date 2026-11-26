import type { Metadata } from "next";
import { MeiView } from "./view";

export const metadata: Metadata = { title: "Meu MEI" };

export default function Page() {
  return <MeiView />;
}
