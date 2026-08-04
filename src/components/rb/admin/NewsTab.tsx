import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { adminListNews, adminUpsertNews, adminDeleteNews } from "@/lib/rb-admin.functions";

type News = { id?: string; title?: string | null; description?: string | null; is_active?: boolean | null };

function NewsEditor({ token, initial, onSaved }: { token: string; initial: News; onSaved: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertNews);
  const deleteFn = useServerFn(adminDeleteNews);
  const [d, setD] = useState<News>(initial);
  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: d } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-news"] }); onSaved(); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { token, id: d.id! } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-news"] }),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <input
        value={d.title ?? ""}
        placeholder="Title"
        onChange={(e) => setD({ ...d, title: e.target.value })}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <textarea
        value={d.description ?? ""}
        placeholder="Description"
        rows={3}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={!!d.is_active} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
        Active
      </label>
      <div className="flex items-center gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        {d.id && (
          <button onClick={() => { if (confirm("Delete this news item?")) del.mutate(); }} disabled={del.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {save.error && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
    </div>
  );
}

export function NewsTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListNews);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["admin-news"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { news: News[] };
    },
  });

  return (
    <div className="space-y-2">
      <button onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10">
        <Plus className="h-3 w-3" /> {creating ? "Cancel" : "Add news"}
      </button>
      {creating && <NewsEditor token={token} initial={{ is_active: true }} onSaved={() => setCreating(false)} />}
      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data?.news ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No news items yet.</p>
      ) : (
        (q.data!.news).map((n) => <NewsEditor key={n.id} token={token} initial={n} onSaved={() => {}} />)
      )}
    </div>
  );
}