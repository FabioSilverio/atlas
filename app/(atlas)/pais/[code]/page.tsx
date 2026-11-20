import type { Metadata } from "next";
import { CountryDossier } from "@/components/dossier/CountryDossier";
import { getDossier, getMapData } from "@/lib/queries";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getMapData()).map((c) => ({ code: c.code }));
}

export async function generateMetadata({ params }: PageProps<"/pais/[code]">): Promise<Metadata> {
  const { code } = await params;
  const d = await getDossier(code.toUpperCase());
  return { title: d ? `Dossiê: ${d.name}` : "País não encontrado" };
}

export default async function CountryPage({ params }: PageProps<"/pais/[code]">) {
  const { code } = await params;
  return <CountryDossier code={code.toUpperCase()} />;
}
