/**
 * Data cleanup approved by Dan on 2026-11-20 (from the review of the 103 live companies).
 * Companies are matched by their domain. Applied once from the back office (Companies → Clean up);
 * applying again changes nothing.
 *
 *  - remove: rejected with the reason kept on record, so discovery never adds them again;
 *  - fix: corrected names, descriptions, types and categories; the company is re-verified on its own homepage.
 */
import type { OrgType } from "./profile.ts";

export const CLEANUP_REASON = "Data cleanup 2026-11-20: not a company founders would partner with.";

export const CLEANUP_REMOVE: { domain: string; name: string; why: string }[] = [
  { domain: "alexeysound.ae", name: "Alexey Sound", why: "Local service" },
  { domain: "beachclubs.ae", name: "BeachClubs.ae", why: "Local service" },
  { domain: "yashnandvana.in", name: "Yash Nandvana", why: "Personal site" },
  { domain: "serviceengineer.academy", name: "Service Engineer Academy", why: "Local service" },
  { domain: "tributs.ad", name: "Tributs", why: "Local service" },
  { domain: "inside.ad", name: "Inside", why: "Local service" },
  { domain: "memeo.app", name: "AI Meme Video Generator", why: "Consumer app" },
  { domain: "brainsaver.app", name: "Brainsaver", why: "Consumer app" },
  { domain: "blockofbytes.com", name: "Block of Bytes", why: "Consumer app" },
  { domain: "mazvantage.com", name: "Maz Vantage", why: "Consumer app" },
  { domain: "tronenergyfrog.com", name: "TronEnergyFrog", why: "Consumer app" },
  { domain: "mizan.ac", name: "Mizan", why: "Consumer app" },
  { domain: "galleries.artfish.ai", name: "AquarIum", why: "Single project" },
  { domain: "openbutterfly.com", name: "OpenButterfly", why: "Single project" },
  { domain: "artificialliabilities.com", name: "Artificial Liabilities", why: "Single project" },
  { domain: "toolifyhub.tools", name: "ToolifyHub.tools", why: "Free tool site" },
  { domain: "gettoolbelt.dev", name: "Toolbelt", why: "Free tool site" },
  { domain: "icons.kubai.design", name: "Kubai Icons", why: "Single project" },
  { domain: "pizza.hertzbeat.com", name: "Pizza", why: "Single project" },
  {
    domain: "marketplace.visualstudio.com",
    name: "Extensions for Visual Studio",
    why: "A marketplace page, not a company",
  },
  { domain: "apogee.ad", name: "Apogee", why: "Outside our focus" },
  { domain: "pantheon.ad", name: "Pantheon", why: "Outside our focus" },
  { domain: "dansugc.com", name: "DansUGC", why: "Outside our focus" },
  { domain: "dark-factory.eu", name: "Dark Factory", why: "No information" },
  // Dan's call: removed (kept: The Product Compass, Getlead).
  { domain: "otusanalytics.com", name: "Otus Analytics", why: "Outside our focus" },
  { domain: "getcinnamon.ai", name: "Cinnamon AI", why: "Consumer app" },
  { domain: "yabanin.ai", name: "YABANIN", why: "Outside our focus" },
  { domain: "apexai.academy", name: "Apex AI Academy", why: "Courses" },
  { domain: "flaient.com", name: "flAIent", why: "Courses" },
  { domain: "ase.academy", name: "ASE Academy", why: "Courses" },
];

export const CLEANUP_FIX: {
  domain: string;
  name?: string;
  description?: string;
  org_type?: OrgType;
  categories?: string[];
  why: string;
}[] = [
  {
    domain: "modelcontextprotocol.io",
    description: "Open standard for connecting AI applications to tools and data.",
    org_type: "ecosystem",
    categories: ["mcp"],
    why: "An open standard, not a company; had no description or category",
  },
  { domain: "useblobby.com", name: "Blobby", why: "Name was the page title" },
  { domain: "soduwork.ai", name: "SoduWork", why: "Name was the page title" },
  { domain: "bla.tools", name: "BLA", why: "Name had the repository name" },
  { domain: "asm.build", categories: ["dev-platforms"], why: "Had no category" },
  { domain: "getle.ad", categories: ["ai-agents"], why: "MCP tag came from its GitHub repo, not its product" },
];
