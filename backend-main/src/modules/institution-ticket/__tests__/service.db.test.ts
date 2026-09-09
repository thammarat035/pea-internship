import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockSelect = mock();

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

mock.module("@/db", () => ({ db: { select: mockSelect } }));

const { InstitutionTicketService } = await import("../service");
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockSelect.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("InstitutionTicketService.findById", () => {
  it("คืนข้อมูลสถาบันที่พบ", async () => {
    const service = new InstitutionTicketService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, institutionsType: "UNIVERSITY", name: "ม.เกษตรศาสตร์" }]),
    );

    const result = await service.findById(1);

    expect(result).toEqual({ id: 1, institutionsType: "UNIVERSITY", name: "ม.เกษตรศาสตร์" });
  });

  it("throws NotFoundError เมื่อไม่พบสถาบัน", async () => {
    const service = new InstitutionTicketService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.findById(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
