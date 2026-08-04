import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hello India" },
      { name: "description", content: "A simple hello India page." },
      { property: "og:title", content: "Hello India" },
      { property: "og:description", content: "A simple hello India page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
      <h1 className="text-4xl font-bold text-highlight">Hello, India!</h1>
      <Link to="/title" className="text-sm text-muted-foreground underline">
        Go to title page
      </Link>
    </main>
  );
}
