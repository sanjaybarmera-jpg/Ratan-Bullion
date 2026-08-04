import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/title")({
  head: () => ({
    meta: [
      { title: "Title Page" },
      { name: "description", content: "A dedicated page showing the title." },
      { property: "og:title", content: "Title Page" },
      {
        property: "og:description",
        content: "A dedicated page showing the title.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TitlePage,
});

function TitlePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
      <h1 className="text-5xl font-bold text-highlight">Hello, India!</h1>
      <Link to="/" className="text-sm text-muted-foreground underline">
        Back home
      </Link>
    </main>
  );
}
