import Link from "next/link";
import type { ReactNode } from "react";

/** Scrollable full page with the ATLAS top bar; used by thinker, ideology and index pages. */
export function PageShell({ children, back = { href: "/", label: "← mapa" }, wide = false }: { children: ReactNode; back?: { href: string; label: string }; wide?: boolean }) {
  return (
    <div className="scroll-thin h-dvh overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-line bg-panel px-4">
        <Link href="/" className="font-mono text-[13px] tracking-[0.3em] text-ink">
          ATLAS
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[11px] text-ink-2">
          <Link href="/pensadores" className="hover:text-cyan">pensadores</Link>
          <Link href="/ideologias" className="hover:text-cyan">ideologias</Link>
          <Link href="/busca" className="hover:text-cyan">busca</Link>
          <Link href="/metodologia" className="hidden hover:text-cyan sm:inline">metodologia</Link>
          <Link href={back.href} className="hover:text-cyan">{back.label}</Link>
        </nav>
      </header>
      <main className={`mx-auto ${wide ? "max-w-5xl" : "max-w-3xl"} px-5 py-8`}>{children}</main>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between border-b border-line pb-1.5">
        <h2 className="label">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Chips({ items, href }: { items: { qid: string; label: string }[]; href?: (qid: string) => string | null }) {
  if (!items.length) return <span className="text-[13px] text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => {
        const h = href?.(i.qid);
        const cls = "border border-line-strong px-1.5 py-0.5 text-[12.5px] text-ink-2";
        return h ? (
          <Link key={i.qid} href={h} className={`${cls} hover:border-cyan-dim hover:text-cyan`}>
            {i.label}
          </Link>
        ) : (
          <span key={i.qid} className={cls}>
            {i.label}
          </span>
        );
      })}
    </div>
  );
}
