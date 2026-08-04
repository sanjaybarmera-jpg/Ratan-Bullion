import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Ratan Jewellers Admin" },
      { name: "description", content: "Send announcements and offers to store customers." },
      { property: "og:title", content: "Notifications — Ratan Jewellers Admin" },
      { property: "og:description", content: "Send announcements and offers to customers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  body: z.string().trim().min(1, "Message is required").max(500),
  audience: z.string().min(1),
});

function NotificationsPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");

  const { data: sent } = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const send = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const { error } = await supabase.from("notifications").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Announcement sent");
      setTitle("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ title, body, audience });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    send.mutate(parsed.data);
  }

  return (
    <div className="animate-rise space-y-5">
      <div>
        <h1 className="gold-text font-display text-3xl">Notifications</h1>
        <p className="text-sm text-muted-foreground">Offers and announcements for customers.</p>
      </div>

      <Card className="glass-panel max-w-xl">
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder="Akshaya Tritiya offer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={500}
                placeholder="Flat 20% off on making charges this weekend."
              />
            </div>
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All customers</SelectItem>
                  <SelectItem value="buyers">Past buyers</SelectItem>
                  <SelectItem value="scheme">Gold scheme members</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="gap-2" disabled={send.isPending}>
              <Send className="h-4 w-4" /> Send announcement
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="font-display text-xl">Sent</h2>
        {(sent ?? []).map((n) => (
          <Card key={n.id} className="glass-panel">
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.body}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="outline" className="capitalize">
                  {n.audience}
                </Badge>
                <span className="text-[0.65rem] text-muted-foreground">{shortDate(n.sent_at)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {(sent ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        )}
      </div>
    </div>
  );
}
