/** Payersight logo: the sunrise mark (amber sun over the horizon line) and the lowercase wordmark. */
export function BrandMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className={className}>
      <path d="M13 30a11 11 0 0 1 22 0z" fill="#F2A33A" />
      <path d="M5 36h38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ size = "sm" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-1.5 text-ink" aria-label="Payersight">
      <BrandMark size={lg ? 30 : 24} />
      <span className={`${lg ? "text-2xl" : "text-[19px]"} font-semibold leading-none tracking-tight`}>payersight</span>
    </span>
  );
}
