import { Skeleton } from "@/components/ui/skeleton";

/**
 * User Management skeleton (#1444).
 *
 * `users/page.tsx` awaits `auth()`, then `getAllUsers()` and
 * `getUserManagementMetrics()` together. The placeholder keeps the page's header,
 * its three metric tiles and the users table.
 */
export default function AdminUsersLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading user management">
      <div className="flex items-start gap-4">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="glass-card rounded-xl p-6">
            <Skeleton className="mb-3 h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="glass-card rounded-xl p-6">
        <Skeleton className="mb-6 h-10 w-full sm:max-w-xs" />
        <div className="space-y-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <Skeleton className="h-10 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
