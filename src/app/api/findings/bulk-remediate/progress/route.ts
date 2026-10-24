import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { MAX_PAGE_SIZE } from "@/lib/findings/query";

export const dynamic = "force-dynamic";

const DEFAULT_TOTAL = MAX_PAGE_SIZE;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const rawTotal = searchParams.get("total");

  let totalFindings = DEFAULT_TOTAL;
  if (rawTotal !== null) {
    // Accept a plain positive integer only. `parseInt` also accepts "12abc",
    // and Number() accepts an empty string as zero; neither is a count.
    if (!/^[1-9]\d*$/.test(rawTotal) || Number(rawTotal) > MAX_PAGE_SIZE) {
      return NextResponse.json(
        {
          error: "Invalid total",
          message: `total must be an integer between 1 and ${MAX_PAGE_SIZE}`,
        },
        { status: 400 },
      );
    }
    totalFindings = Number(rawTotal);
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string): boolean => {
        if (cancelled) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          return true;
        } catch {
          cancelled = true;
          return false;
        }
      };

      try {
        for (let i = 1; i <= totalFindings; i++) {
          if (cancelled) break;

          const progress = Math.round((i / totalFindings) * 100);
          const data = JSON.stringify({
            processed: i,
            total: totalFindings,
            progress,
            status: i === totalFindings ? "completed" : "processing",
            message: `Remediating finding ${i} of ${totalFindings}...`,
          });

          if (!send(data)) break;

          // Small artificial delay for smooth real-time streaming effect
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch {
        send(JSON.stringify({ status: "error", message: "Stream interrupted" }));
      } finally {
        if (!cancelled) {
          cancelled = true;
          try {
            controller.close();
          } catch {
            // The client may have disconnected between the last send and close.
          }
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
