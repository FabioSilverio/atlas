import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell } from "@/components/page/PageShell";
import { SearchResults } from "./SearchResults";

export const metadata: Metadata = { title: "Busca" };

export default function SearchPage() {
  return (
    <PageShell wide>
      <Suspense>
        <SearchResults />
      </Suspense>
    </PageShell>
  );
}
