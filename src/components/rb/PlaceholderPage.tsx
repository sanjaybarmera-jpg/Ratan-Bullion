type Props = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: Props) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-primary/80">Ratan Bullion</p>
        <h2 className="text-2xl font-semibold mt-1">{title}</h2>
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="mt-3 text-xs text-muted-foreground">Coming soon in a later phase.</p>
      </div>
    </section>
  );
}