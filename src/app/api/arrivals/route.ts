import { fetchArrivals } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await fetchArrivals(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "feed_unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
