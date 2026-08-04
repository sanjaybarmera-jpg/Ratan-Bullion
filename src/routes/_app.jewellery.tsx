import { createFileRoute } from "@tanstack/react-router";
import { JewelleryPage } from "@/components/rb/JewelleryPage";

export const Route = createFileRoute("/_app/jewellery")({
  head: () => ({
    meta: [
      { title: "Jewellery Collection — Ratan Bullion" },
      {
        name: "description",
        content:
          "Browse Ratan Bullion's gold and silver jewellery catalogue with product details and instant WhatsApp or call enquiry.",
      },
      { property: "og:title", content: "Jewellery Collection — Ratan Bullion" },
      {
        property: "og:description",
        content: "Gold and silver jewellery catalogue with instant enquiry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JewelleryPage,
});
