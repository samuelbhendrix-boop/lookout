/** Workspace or user icon: an uploaded image, an emoji, or the first letter of the name. */
export function Avatar({ icon, name, size = 24, square = false }: { icon?: string | null; name: string; size?: number; square?: boolean }) {
  const shape = square ? "rounded-md" : "rounded-full";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.5) };
  if (icon?.startsWith("data:image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" style={style} className={`${shape} shrink-0 object-cover`} />;
  }
  if (icon) return <span style={{ ...style, fontSize: Math.round(size * 0.7) }} className={`${shape} flex shrink-0 items-center justify-center leading-none`}>{icon}</span>;
  return <span style={style} className={`${shape} flex shrink-0 items-center justify-center bg-stone-200 font-medium uppercase text-stone-600`}>{(name.trim()[0] ?? "?")}</span>;
}
