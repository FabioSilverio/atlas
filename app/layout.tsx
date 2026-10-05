import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "ATLAS — ideias, pensadores e ideologias no poder", template: "%s · ATLAS" },
  description:
    "Painel global de quem governa cada país, com a posição ideológica medida por bases acadêmicas (CHES, ParlGov, Global Party Survey), ganhadores do Nobel e fontes rastreáveis.",
};

export const viewport: Viewport = { themeColor: "#07090b", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
