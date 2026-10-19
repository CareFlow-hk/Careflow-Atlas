import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demoFixture";
import { snapshotSchema } from "./schema";

const copy = () => structuredClone(demoSnapshot);

describe("snapshotSchema", () => {
  it.each([
    ["households", () => ({ ...copy().households[0], isSynthetic: false })],
    ["people", () => ({ ...copy().people[0], displayName: "" })],
    ["householdMemberships", () => ({ ...copy().householdMemberships[0], personId: "missing" })],
    ["householdResidences", () => ({ ...copy().householdResidences[0], householdId: "missing" })],
    ["memberships", () => ({ ...copy().memberships[0], personId: "missing" })],
  ])("rejects malformed %s records", (collection, invalidRow) => {
    const snapshot = copy() as unknown as Record<string, unknown[]>;
    snapshot[collection] = [invalidRow()];
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects impossible calendar dates and date-only event times", () => {
    const impossible = copy();
    impossible.visits[0].occurredAt = "2026-02-31T18:30:00+08:00";
    expect(snapshotSchema.safeParse(impossible).success).toBe(false);

    const dateOnly = copy();
    dateOnly.observations[0].recordedAt = "2026-09-09";
    expect(snapshotSchema.safeParse(dateOnly).success).toBe(false);
  });

  it("validates parent references even when no observation uses the record", () => {
    const badFloor = copy();
    badFloor.observations = [];
    badFloor.floors[0].buildingId = "missing-building";
    expect(snapshotSchema.safeParse(badFloor).success).toBe(false);

    const badUnit = copy();
    badUnit.observations = [];
    badUnit.units[0].floorId = "bldg-hoi-king-f1";
    expect(snapshotSchema.safeParse(badUnit).success).toBe(false);
  });

  it("rejects a follow-up resolution aimed at a different location", () => {
    const snapshot = copy();
    snapshot.observations.push({
      ...snapshot.observations[0],
      id: "resolution-at-wrong-location",
      unitId: "bldg-yu-an-f5-A",
      recordedAt: "2026-09-10T12:00:00+08:00",
      followUp: { action: "合成：完成", status: "DONE" },
      resolvesObservationId: "observation-yu-an-5b",
    });
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("accepts an author and a withdrawal marker, and refuses a malformed one", () => {
    const snapshot = copy();
    const author = { accountId: "account-1", name: "同事" };
    snapshot.observations[0].createdBy = author;
    snapshot.observations[1] = { ...snapshot.observations[1], deleted: { at: "2026-10-19T09:00:00.000Z", by: author } };
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);

    const broken = copy() as unknown as { observations: Record<string, unknown>[] };
    broken.observations[0].deleted = { at: "2026-10-19", by: author };
    expect(snapshotSchema.safeParse(broken).success).toBe(false);
    const nameless = copy() as unknown as { observations: Record<string, unknown>[] };
    nameless.observations[0].createdBy = { accountId: "" };
    expect(snapshotSchema.safeParse(nameless).success).toBe(false);
  });

  it("lets a withdrawn resolution stop closing the task it named", () => {
    // The same snapshot validates either way; what changes is that the task is open again.
    const snapshot = copy();
    const author = { accountId: "account-1", name: "同事" };
    snapshot.observations.push({
      ...snapshot.observations[0],
      id: "withdrawn-resolution",
      recordedAt: "2026-09-10T12:00:00+08:00",
      followUp: { action: "合成：完成", status: "DONE" },
      resolvesObservationId: "observation-yu-an-5b",
      createdBy: author,
      deleted: { at: "2026-10-19T09:00:00.000Z", by: author },
      visitId: snapshot.observations[0].visitId,
    });
    snapshot.observations.push({
      ...snapshot.observations[0],
      id: "live-resolution",
      recordedAt: "2026-09-11T12:00:00+08:00",
      followUp: { action: "合成：完成", status: "DONE" },
      resolvesObservationId: "observation-yu-an-5b",
      visitId: snapshot.observations[0].visitId,
    });
    // A withdrawn resolution no longer claims the task, so a later live one is not a duplicate.
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});
