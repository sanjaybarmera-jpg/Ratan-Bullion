import { createFileRoute } from "@tanstack/react-router";
import { BankPage } from "@/components/rb/BankPage";

export const Route = createFileRoute("/_app/bank")({
  head: () => ({
    meta: [
      { title: "Bank Details — Ratan Bullion" },
      { name: "description", content: "Bank, UPI and GST details for payments." },
    ],
  }),
  component: BankPage,
});
