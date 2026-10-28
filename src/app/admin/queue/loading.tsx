import { Skeleton } from "@/components/ui/skeleton";

/**
 * Queue Monitor skeleton (#1444).
 *
 * `queue/page.tsx` is `force-dynamic` and awaits `getQueueMetrics()` and then
 * `getDLQJobs()` one after the other, both of which reach out to Redis. That is
 * the slowest admin page to open, so it gets the five stat tiles the real page
 * has (waiting, active, completed, failed, delayed) and the two tables below.
 */
export default function AdminQueueLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading queue monitor">
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="glass-card rounded-xl p-6">
            <div className="flex items-center justify-between pb-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>

      {[0, 1].map((index) => (
        <div key={index} className="glass-card rounded-xl p-6">
          <Skeleton className="mb-6 h-5 w-48" />
          <div className="space-y-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
