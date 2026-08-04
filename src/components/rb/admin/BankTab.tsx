import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  adminListBanks,
  adminUpsertBank,
  adminDeleteBank,
} from "@/lib/rb-admin.functions";

type Bank = {
  id?: string;
  label?: string | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_no?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upi_id?: string | null;
  gst_no?: string | null;
  is_active?: boolean | null;
  sort_order?: number | null;
};

const FIELDS: { key: keyof Bank; label: string }[] = [
  { key: "label", label: "Label" },
  { key: "bank_name", label: "Bank Name" },
  { key: "account_name", label: "Account Name" },
  { key: "account_no", label: "Account Number" },
  { key: "ifsc", label: "IFSC" },
  { key: "branch", label: "Branch" },
  { key: "upi_id", label: "UPI ID" },
  { key: "gst_no", label: "GST Number" },
];

function BankEditor({ token, initial, onSaved }: { token: string; initial: Bank; onSaved: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertBank);
  const deleteFn = useServerFn(adminDeleteBank);
  const [draft, setDraft] = useState<Bank>(initial);
  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: draft } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-banks"] }); onSaved(); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { token, id: draft.id! } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-banks"] }),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={String(f.key)} className="text-[10px] text-muted-foreground col-span-2 sm:col-span-1">
            <span className="block uppercase tracking-wider">{f.label}</span>
            <input
              value={(draft[f.key] as string) ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        ))}
        <label className="text-[10px] text-muted-foreground">
          <span className="block uppercase tracking-wider">Sort</span>
          <input
            type="number"
            value={draft.sort_order ?? 0}
            onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
            className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={!!draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
          Active
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        {draft.id && (
          <button
            onClick={() => { if (confirm("Delete this bank entry?")) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {save.error && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
    </div>
  );
}

export function BankTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListBanks);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["admin-banks"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { banks: Bank[] };
    },
  });

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
      >
        <Plus className="h-3 w-3" /> {creating ? "Cancel" : "Add bank"}
      </button>
      {creating && (
        <BankEditor
          token={token}
          initial={{ is_active: true, sort_order: 0 }}
          onSaved={() => setCreating(false)}
        />
      )}
      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data?.banks ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No bank entries yet.</p>
      ) : (
        (q.data!.banks).map((b) => <BankEditor key={b.id} token={token} initial={b} onSaved={() => {}} />)
      )}
    </div>
  );
}