/**
 * Skeleton shown while the company page resolves.
 *
 * Mirrors the real layout so the page does not visibly reflow when data
 * arrives.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1400px] px-5">
          <div className="h-11 border-b border-line" />
          <div className="flex items-end justify-between gap-8 py-4">
            <div>
              <div className="h-6 w-52 bg-raised" />
              <div className="mt-2 h-3 w-36 bg-raised" />
            </div>
            <div className="hidden gap-8 sm:flex">
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <div className="h-2.5 w-16 bg-raised" />
                  <div className="mt-1.5 h-4 w-20 bg-raised" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-5 py-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel">
            <div className="panel-header">
              <div className="h-3 w-40 bg-raised" />
            </div>
            <div className="panel-body space-y-2">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-4 w-full bg-raised" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
