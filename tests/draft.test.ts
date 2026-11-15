import { describe, expect, it } from "vitest";
import { buildDraft, PLACEHOLDER } from "../shared/draft.ts";

const base = {
  variant: "first" as const,
  goal: "integrations" as const,
  founder: {
    name: "Ada Test",
    role: "CEO",
    company_name: "Example Co",
    one_liner: "Payments API for small businesses",
    website: "https://exampleco.dev",
  },
  company: { name: "Example Pay" },
  recipientName: "Jane Example",
  signal: { type: "partner_program_launched" as const, event_date: "2026-11-10" },
};

describe("buildDraft", () => {
  it("writes a first message from verified facts and the founder's answers, leaving the fit for them", () => {
    const d = buildDraft(base);
    expect(d.subject).toBe("Integration idea: Example Co × Example Pay");
    expect(d.message).toContain("Hi Jane,");
    expect(d.message).toContain("I saw Example Pay opened its partner program on 10 Nov.");
    expect(d.message).toContain("I'm Ada, CEO of Example Co. Payments API for small businesses.");
    expect(d.message).toMatch(PLACEHOLDER);
    expect(d.message).toContain("exampleco.dev");
    expect(d.message.length).toBeLessThan(1200);
  });

  it("addresses the team when there's no verified person, and stays honest without a signal", () => {
    const d = buildDraft({ ...base, recipientName: null, signal: null });
    expect(d.message).toContain("Hi Example Pay team,");
    expect(d.message).toContain("I've been looking at what Example Pay is building.");
  });

  it("has shorter and follow-up versions", () => {
    const short = buildDraft({ ...base, variant: "shorter" });
    expect(short.message.length).toBeLessThan(600);
    expect(short.message).not.toMatch(PLACEHOLDER);
    const follow = buildDraft({ ...base, variant: "follow_up" });
    expect(follow.subject.startsWith("Re: ")).toBe(true);
    expect(follow.message).toMatch(/Following up/);
  });
});
