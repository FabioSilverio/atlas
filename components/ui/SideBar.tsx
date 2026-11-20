import { css, divergingColor } from "@/lib/ui/palette";

const LEFT = css(divergingColor(-0.75));
const CENTER = "rgba(150,160,172,0.55)";
const RIGHT = css(divergingColor(0.75));
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Stacked left / centre / right share bar, with labels. Animates when the shares change. */
export function SideBar({ left, center, right, height = 10, labels = true }: { left: number; center: number; right: number; height?: number; labels?: boolean }) {
  const total = left + center + right || 1;
  const seg = (v: number) => ({ width: `${(v / total) * 100}%`, transition: "width 700ms cubic-bezier(.2,.8,.2,1)" });
  return (
    <div>
      <div className="flex w-full gap-[2px] overflow-hidden" style={{ height }} role="img" aria-label={`esquerda ${pct(left)}, centro ${pct(center)}, direita ${pct(right)}`}>
        <span style={{ ...seg(left), background: LEFT }} className="rounded-l-sm" />
        <span style={{ ...seg(center), background: CENTER }} />
        <span style={{ ...seg(right), background: RIGHT }} className="rounded-r-sm" />
      </div>
      {labels && (
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular">
          <span className="text-ink-2">esq. {pct(left)}</span>
          <span className="text-muted">centro {pct(center)}</span>
          <span className="text-ink-2">dir. {pct(right)}</span>
        </div>
      )}
    </div>
  );
}

/** "Right ahead by 12 pp", "tie"… for the larger side of attention. */
export function leader(left: number, right: number): { text: string; side: "left" | "right" | "tie" } {
  const d = Math.round((right - left) * 100);
  if (Math.abs(d) < 5) return { text: "equilíbrio entre os lados", side: "tie" };
  return d > 0 ? { text: `direita à frente por ${d} p.p.`, side: "right" } : { text: `esquerda à frente por ${-d} p.p.`, side: "left" };
}
