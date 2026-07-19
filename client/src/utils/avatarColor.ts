/** Deterministic decorative color per account name — identity, not data encoding. */
export function avatarColorVar(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const slot = (hash % 8) + 1;
  return `var(--avatar-${slot})`;
}

export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
