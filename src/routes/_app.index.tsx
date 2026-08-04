import { createFileRoute } from "@tanstack/react-router";
import { LiveRatePage } from "@/components/rb/LiveRatePage";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Ratan Bullion | Live Gold & Silver Rates" },
      {
        name: "description",
        content:
          "Ratan Bullion provides live gold and silver rates, bullion trading services, and easy online order management.",
      },
      { property: "og:title", content: "Ratan Bullion | Live Gold & Silver Rates" },
      {
        property: "og:description",
        content:
          "Live gold and silver rates, bullion trading services, and easy online order management.",
      },
      { property: "og:url", content: "https://ratanbullion.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://ratanbullion.lovable.app/" }],
  }),
  component: LiveRatePage,
});