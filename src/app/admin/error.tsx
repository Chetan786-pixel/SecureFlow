"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

/**
 * Admin segment error boundary (#1444).
 *
 * Nested deliberately, the same way `src/app/dashboard/error.tsx` is.
 * `src/app/admin/layout.tsx` renders the sidebar, header and mobile nav; a
 * boundary at this level replaces only the `<main>` content, so when one admin
 * query fails (the audit log, the BullMQ queue metrics, the user list) the
 * navigation stays usable and the admin can move to a page that still works.
 *
 * The error message is never rendered or logged: a thrown Prisma or Redis error
 * can carry a connection string. Only the Next.js digest is shown, which lets
 * the admin quote it to find the full stack in the server log.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SecureFlow] admin error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <ErrorState
      title="This admin view failed to load"
      description="We could not read the admin data just now. Nothing was changed — this is a problem reading it, not saving it. Try again, or use the sidebar to open a different admin page."
      digest={error.digest}
      onRetry={reset}
      showDashboardLink={false}
      className="min-h-[50vh]"
    />
  );
}
