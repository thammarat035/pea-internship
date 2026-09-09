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

const { DepartmentTicketService } = await import("../service");
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockSelect.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("DepartmentTicketService.findById", () => {
  it("คืนข้อมูลหน่วยงานที่พบ", async () => {
    const service = new DepartmentTicketService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { deptSap: 10, deptShort: "IT", deptFull: "ฝ่าย IT", location: null, officeId: 1 },
      ]),
    );

    const result = await service.findById(10);

    expect(result).toMatchObject({ deptSap: 10, deptShort: "IT" });
  });

  it("throws NotFoundError เมื่อไม่พบหน่วยงาน", async () => {
    const service = new DepartmentTicketService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.findById(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
