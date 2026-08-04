import { createFileRoute } from "@tanstack/react-router";
import { MarketTerminalPage } from "@/components/rb/MarketTerminalPage";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({
    meta: [
      { title: "Market Terminal — Ratan Bullion" },
      {
        name: "description",
        content:
          "Professional MCX Gold and Silver candlestick charts with multiple timeframes.",
      },
    ],
  }),
  component: () => <MarketTerminalPage />,
});