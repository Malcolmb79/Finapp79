import { avatarColorVar, initials } from "../utils/avatarColor.js";

export default function AccountAvatar({ name, logo }: { name: string; logo?: string | null }) {
  if (logo) {
    return <img src={logo} alt="" className="avatar-chip" style={{ background: "#fff", objectFit: "contain", padding: 3 }} />;
  }
  return (
    <div className="avatar-chip" style={{ background: avatarColorVar(name) }}>
      {initials(name)}
    </div>
  );
}
