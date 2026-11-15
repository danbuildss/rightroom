import { describe, expect, it } from "vitest";
import { suggest } from "../shared/intel.ts";

const base = {
  companyName: "Example Pay",
  sectors: ["Payments"],
  goals: ["integrations" as const],
  founder: { company_name: "Example Co", one_liner: "Payments API for small businesses", buyers: "SMEs" },
  signals: [{ type: "partner_program_launched" as const, event_date: "2026-11-10", fresh: true }],
  channels: [],
};

describe("company suggestions", () => {
  it("builds 'why partner', role and approach from the founder's answers and verified signals", () => {
    const s = suggest(base);
    expect(s.for_you).toMatch(/partner program/);
    expect(s.for_them).toContain("Payments API for small businesses");
    expect(s.suggested_role).toMatch(/partner program/);
    expect(s.approach).toMatch(
      /^Apply through their partner program and propose an integration\. Mention their partner program launched on 10 Nov\./,
    );
    expect(s.based_on).toContain("Example Pay");
  });

  it("uses an official channel when there's no partner program", () => {
    const s = suggest({
      ...base,
      signals: [{ type: "api_or_sdk_released", event_date: null, fresh: true }],
      channels: [{ label: "Partner form" }],
    });
    expect(s.approach).toMatch(/^Reach out through their partner form/);
  });

  it("stays modest with no verified signals and asks for a one-liner when missing", () => {
    const s = suggest({ ...base, signals: [], founder: { company_name: null, one_liner: null, buyers: null } });
    expect(s.for_you).toMatch(/once there's a verified signal/);
    expect(s.for_them).toMatch(/Add a one-line description/);
    expect(s.approach_why).toMatch(/no verified signal yet/);
  });
});
