import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: "./fonts/plex-sans.woff2",
  variable: "--font-plex-sans",
  weight: "400 600",
});
const mono = localFont({
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400" },
    { path: "./fonts/plex-mono-500.woff2", weight: "500" },
  ],
  variable: "--font-plex-mono",
});

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
