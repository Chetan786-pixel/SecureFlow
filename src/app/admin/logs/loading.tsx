import { Skeleton } from "@/components/ui/skeleton";

/**
 * Audit Logs skeleton (#1444).
 *
 * `logs/page.tsx` awaits `getAuditLogs()` (up to 200 rows), `getAuditLogMetrics()`
 * and `getAuditLogFilters()` together. The placeholder keeps the page's header,
 * three metric tiles, filter bar and table so nothing shifts on arrival.
 */
export default function AdminLogsLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading audit logs">
      <div className="flex items-start gap-4">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="glass-card rounded-xl p-6">
            <Skeleton className="mb-3 h-3 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-10 w-full sm:max-w-xs" />
          <Skeleton className="h-10 w-full sm:w-44" />
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
