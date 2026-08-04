import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "@/components/rb/OrdersPage";

export const Route = createFileRoute("/_app/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Ratan Bullion" },
      { name: "description", content: "Your bullion buy and sell orders." },
    ],
  }),
  component: OrdersPage,
});