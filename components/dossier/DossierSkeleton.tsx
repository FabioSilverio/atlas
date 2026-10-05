export function DossierSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-4" aria-busy="true" aria-label="Carregando dossiê">
      <div className="flex gap-3">
        <div className="h-8 w-11 bg-panel-3" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 bg-panel-3" />
          <div className="h-3 w-1/3 bg-panel-2" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-panel-2" />
        ))}
      </div>
      <div className="flex gap-4">
        <div className="size-32 bg-panel-2" />
        <div className="flex-1 space-y-3">
          <div className="h-10 bg-panel-2" />
          <div className="h-10 bg-panel-2" />
        </div>
      </div>
      <div className="h-24 bg-panel-2" />
    </div>
  );
}
