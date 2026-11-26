const PALETTE = ["#7c72ff", "#12b886", "#f07b12", "#2f80ed", "#d63fa0", "#0ea5a4", "#a855f7", "#e5484d"];

export function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function ProductAvatar({ name, category, size = 40 }: { name: string; category: string; size?: number }) {
  const color = hashColor(category);
  const letters = name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl text-[13px] font-semibold"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      {letters || name[0]?.toUpperCase()}
    </span>
  );
}
