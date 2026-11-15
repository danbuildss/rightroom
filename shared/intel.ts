/**
 * Company intelligence suggestions: "why partner", "who decides" and "best approach".
 * These are Rightroom's suggestions, built by rules from the founder's own answers and the
 * company's verified signals. They are always labelled as suggestions, never as facts.
 */
import { GOAL_LABELS, type Goal } from "./discover.ts";
import { SIGNAL_TYPES, type SignalType } from "./signals.ts";

export interface IntelInput {
  /** The company's confirmed type (platform_api, ecosystem…), if any. */
  orgType?: string | null;
  companyName: string;
  sectors: string[];
  goals: Goal[];
  founder: { company_name: string | null; one_liner: string | null; buyers: string | null };
  /** Newest first; fresh = within the signal type's freshness window. */
  signals: { type: SignalType; event_date: string | null; fresh: boolean }[];
  channels: { label: string }[];
}

export interface Suggestions {
  for_you: string;
  for_them: string;
  suggested_role: string;
  approach: string;
  approach_why: string;
  /** What the suggestion was built from, shown to the founder. */
  based_on: string;
  /** Ways the two companies could work together, best first, each with why it fits. */
  structures: { name: string; why: string }[];
}

const day = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

const ROLE_BY_GOAL: Record<Goal, string> = {
  integrations: "Head of Partnerships or the developer relations lead",
  distribution: "Head of Partnerships or business development",
  co_marketing: "Head of Marketing or partnerships",
  ecosystem: "the ecosystem or developer relations lead",
};

const GOAL_NOUN: Record<Goal, string> = {
  integrations: "an integration",
  distribution: "a distribution partnership",
  co_marketing: "a joint launch or co-marketing piece",
  ecosystem: "joining their ecosystem program",
};

export function suggest(input: IntelInput): Suggestions {
  const goal: Goal = input.goals[0] ?? "integrations";
  const top = input.signals.find((s) => s.fresh) ?? input.signals[0];
  const sector = input.sectors[0]?.toLowerCase() ?? "their";
  const yours = input.founder.one_liner?.trim();

  const forYouBySignal: Partial<Record<SignalType, string>> = {
    partner_program_launched: "Join their new partner program and reach their customers through it.",
    collaboration_request: "They're asking for collaborators: answer with one concrete offer.",
    integration_announced: "They're integrating with others; an integration with you could sit alongside.",
    api_or_sdk_released: "Build on their new API or SDK and reach the developers who use it.",
    product_launched: "Pair your product with their new launch while it's getting attention.",
    ecosystem_expansion: "Get into their growing ecosystem and the programs around it.",
    partnerships_role_posted: "They're hiring for partnerships, so someone will own conversations like yours.",
  };
  const for_you = top
    ? (forYouBySignal[top.type] ??
      `A ${GOAL_LABELS[goal].toLowerCase()} partnership with a company active in ${sector}.`)
    : `You share a focus on ${sector}; worth a closer look once there's a verified signal.`;
  const for_them = yours
    ? `What you offer (“${yours}”)${input.founder.buyers ? `, for ${input.founder.buyers},` : ""} could add to what they give their own customers.`
    : "Add a one-line description of your company so we can say what they'd gain.";

  const program = input.signals.some((s) => s.type === "partner_program_launched");
  const suggested_role = `${ROLE_BY_GOAL[goal]}${program ? ", or whoever runs the partner program" : ""}`;

  const channel = input.channels[0]?.label;
  const recent = top?.fresh
    ? `${SIGNAL_TYPES[top.type].label.toLowerCase()}${top.event_date ? ` on ${day(top.event_date)}` : ""}`
    : null;
  const approach = program
    ? `Apply through their partner program and propose ${GOAL_NOUN[goal]}.${recent ? ` Mention their ${recent}.` : ""}`
    : channel
      ? `Reach out through their ${channel.toLowerCase()} with a short, specific proposal for ${GOAL_NOUN[goal]}.${recent ? ` Mention their ${recent}.` : ""}`
      : `Start with the contact route on their official website and propose ${GOAL_NOUN[goal]} in two or three sentences.${recent ? ` Mention their ${recent}.` : ""}`;
  const approach_why = top
    ? `You want ${GOAL_LABELS[goal].toLowerCase()}, and their latest verified signal is: ${SIGNAL_TYPES[top.type].label.toLowerCase()}.`
    : `You want ${GOAL_LABELS[goal].toLowerCase()}; there's no verified signal yet, so keep it light.`;

  // Partnership structures: from their verified signals and type, ordered by the founder's goals.
  const has = (t: SignalType) => input.signals.some((x) => x.type === t);
  const options: { goal: Goal; name: string; why: string | null }[] = [
    {
      goal: "integrations",
      name: "Product integration",
      why: has("api_or_sdk_released")
        ? "They released an API or SDK you could build on."
        : has("integration_announced")
          ? "They're already integrating with other products."
          : input.orgType === "platform_api"
            ? "They're a platform other products build on."
            : null,
    },
    {
      goal: "distribution",
      name: "Referral or reseller partnership",
      why: has("partner_program_launched")
        ? "They run a partner program, a ready-made route to their customers."
        : has("collaboration_request")
          ? "They've asked publicly for partners."
          : null,
    },
    {
      goal: "co_marketing",
      name: "Joint launch or co-marketing",
      why: has("product_launched")
        ? "They just launched something and are looking for attention."
        : has("collaboration_request")
          ? "They're open to collaborating."
          : null,
    },
    {
      goal: "ecosystem",
      name: "Join their ecosystem or program",
      why: has("ecosystem_expansion")
        ? "Their ecosystem is growing, with programs around it."
        : input.orgType === "ecosystem"
          ? "They run a network or protocol other teams build in."
          : has("partner_program_launched")
            ? "Their partner program is a way in."
            : null,
    },
  ];
  const rank = (g: Goal) => (input.goals.includes(g) ? input.goals.indexOf(g) : 10);
  const structures = options
    .filter((o): o is { goal: Goal; name: string; why: string } => o.why !== null)
    .sort((a, b) => rank(a.goal) - rank(b.goal))
    .slice(0, 3)
    .map(({ name, why }) => ({ name, why }));

  return {
    structures,
    for_you,
    for_them,
    suggested_role,
    approach,
    approach_why,
    based_on: `Your answers${yours ? ` (“${yours.slice(0, 60)}”)` : ""} and ${input.companyName}'s verified signals.`,
  };
}
