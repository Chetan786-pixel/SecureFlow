import { Skeleton } from "@/components/ui/skeleton";

/**
 * Admin overview skeleton (#1444).
 *
 * `src/app/admin/page.tsx` is an async server component that awaits
 * `getAdminMetrics()` and `getRecentAuditLogs()` before it can render anything.
 * Without a `loading.tsx` Next.js keeps the previous route on screen until both
 * resolve, so clicking "Overview" in the admin sidebar appears to do nothing.
 *
 * The shape mirrors the real page — a heading block, three metric tiles, then
 * the recent-activity table — so the layout does not jump when the data lands,
 * and it uses the same skeleton primitives as `src/app/dashboard/loading.tsx`.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading admin overview">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="glass-card rounded-xl p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <div className="glass-card rounded-xl p-6">
          <div className="space-y-4">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
