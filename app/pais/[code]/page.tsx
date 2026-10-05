import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CountryDossier } from "@/components/dossier/CountryDossier";
import { getDossier } from "@/lib/queries";

export async function generateMetadata({ params }: PageProps<"/pais/[code]">): Promise<Metadata> {
  const { code } = await params;
  const d = await getDossier(code.toUpperCase());
  return { title: d ? `Dossiê: ${d.name}` : "País não encontrado" };
}

/** Full-page dossier: used on mobile, for printing and for direct links. */
export default async function CountryPage({ params }: PageProps<"/pais/[code]">) {
  const { code } = await params;
  const upper = code.toUpperCase();
  if (!(await getDossier(upper))) notFound();
  return (
    <div className="scroll-thin h-dvh overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-line bg-panel px-4">
        <Link href="/" className="font-mono text-[13px] tracking-[0.3em] text-ink">
          ATLAS
        </Link>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <Link href={`/?pais=${upper}`} className="hidden text-ink-2 hover:text-cyan md:inline">
            ver no mapa
          </Link>
          <Link href="/" className="text-ink-2 hover:text-cyan">
            ← países
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl border-x border-line bg-panel">
        <CountryDossier code={upper} />
      </main>
    </div>
  );
}
