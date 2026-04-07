import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://teranga.sn";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/events`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
  ];

  // Fetch published events for dynamic pages
  try {
    const res = await fetch(`${API_URL}/v1/events?limit=200&status=published`, {
      next: { revalidate: 3600 }, // revalidate hourly
    });

    if (res.ok) {
      const json = await res.json();
      const events = json.data ?? [];

      const eventPages: MetadataRoute.Sitemap = events.map((event: { slug: string; updatedAt: string }) => ({
        url: `${BASE_URL}/events/${event.slug}`,
        lastModified: new Date(event.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));

      return [...staticPages, ...eventPages];
    }
  } catch {
    // If API is unreachable, return static pages only
  }

  return staticPages;
}
