import logoUrl from "@/assets/rb-logo.png";

type Size = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<Size, string> = {
  sm: "w-10 h-10",
  md: "w-14 h-14",
  lg: "w-20 h-20",
  xl: "w-24 h-24",
};

export function BrandLogo({
  size = "md",
  onClick,
  className = "",
}: {
  size?: Size;
  onClick?: () => void;
  className?: string;
}) {
  const s = sizeMap[size];
  return (
    <img
      src={logoUrl}
      alt="Ratan Bullion"
      width={256}
      height={256}
      loading="lazy"
      onClick={onClick}
      className={`${s} object-contain shrink-0 [filter:drop-shadow(0_0_6px_rgba(217,184,86,0.55))_drop-shadow(0_0_18px_rgba(212,175,55,0.35))] ${
        onClick ? "cursor-pointer select-none" : ""
      } ${className}`}
    />
  );
}

export function BrandWordmark({
  size = "md",
  tagline = true,
  align = "center",
}: {
  size?: "sm" | "md" | "lg";
  tagline?: boolean;
  align?: "center" | "left";
}) {
  const titleClass =
    size === "lg"
      ? "text-3xl"
      : size === "md"
        ? "text-xl"
        : "text-base";
  const tagSize = size === "lg" ? "text-[10px]" : "text-[9px]";
  const alignCls = align === "center" ? "items-center text-center" : "items-start text-left";
  return (
    <div className={`flex flex-col ${alignCls} min-w-0`}>
      <h1
        className={`font-display ${titleClass} text-foreground leading-none tracking-[0.08em]`}
        style={{ fontWeight: 600 }}
      >
        Ratan Bullion
      </h1>
      {tagline && (
        <p className={`${tagSize} tracking-[0.42em] text-gold/70 uppercase mt-2`}>
          Bullion Trading Desk
        </p>
      )}
    </div>
  );
}