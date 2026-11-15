import {
  AtSign,
  BookOpen,
  Briefcase,
  FolderGit2,
  Globe,
  Handshake,
  type LucideIcon,
  Mail,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";

export interface Links {
  website: string;
  x: string | null;
  github: string | null;
  partners: string | null;
  docs: string | null;
  linkedin?: string | null;
  email?: string | null;
  contact_form?: string | null;
}

export const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** The company's own logo (stored and served by us), or its initials when there isn't one. */
export function CompanyMark({
  name,
  logo,
  size = "md",
}: {
  name: string;
  logo: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const cls = `ini${size === "md" ? "" : ` ${size}`}`;
  if (logo && !failed) {
    return (
      <span className={`${cls} has-logo`} aria-hidden="true">
        <img src={logo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const handle = (url: string) => url.replace(/^https?:\/\/(www\.)?(x|github)\.com\//i, "").replace(/\/$/, "");
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

/** Website, X, GitHub, partner page and docs: only the ones we have. Each opens in a new tab. */
export function CompanyLinks({ links, name, compact }: { links: Links; name: string; compact?: boolean }) {
  const items: { href: string; label: string; text: string; icon: LucideIcon }[] = [
    { href: links.website, label: `${name} website`, text: compact ? "Website" : host(links.website), icon: Globe },
  ];
  if (links.x)
    items.push({ href: links.x, label: `${name} on X`, text: compact ? "X" : `@${handle(links.x)}`, icon: AtSign });
  if (links.github)
    items.push({
      href: links.github,
      label: `${name} on GitHub`,
      text: compact ? "GitHub" : handle(links.github),
      icon: FolderGit2,
    });
  if (links.partners)
    items.push({ href: links.partners, label: `${name} partner page`, text: "Partner page", icon: Handshake });
  if (links.docs) items.push({ href: links.docs, label: `${name} docs`, text: "Docs", icon: BookOpen });
  if (links.linkedin)
    items.push({ href: links.linkedin, label: `${name} on LinkedIn`, text: "LinkedIn", icon: Briefcase });
  if (links.email)
    items.push({
      href: `mailto:${links.email}`,
      label: `${name} partnerships email, published on their website`,
      text: compact ? "Email" : links.email,
      icon: Mail,
    });
  if (links.contact_form)
    items.push({ href: links.contact_form, label: `${name} contact form`, text: "Contact form", icon: MessageSquare });
  return (
    <ul className="clinks">
      {items.map(({ href, label, text, icon: Icon }) => (
        <li key={href}>
          {href.startsWith("mailto:") ? (
            <a href={href}>
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
              {text}
              <span className="sr">: {label}, opens your email app</span>
            </a>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
              {text}
              <span className="sr">: {label}, opens in a new tab</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
