import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: ยกเลิกใบสมัครที่ค้างสถานะ PENDING_DOCUMENT (ยังไม่ส่งเอกสาร
// สมัครเบื้องต้นเช่น transcript) เกิน 15 วันนับจากวันที่สร้างใบสมัคร
// ---------------------------------------------------------------------------

const mockSelect = mock();
const mockInsertValues = mock((_v?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));
const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock((_s?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};
mock.module("@/db", () => ({ db: dbMock }));

const { ApplicationTimeoutService } = await import("../service");

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationTimeoutService.cancelExpiredApplications", () => {
  it("ไม่ทำอะไรเลยเมื่อไม่มีใบสมัครที่หมดเวลา", async () => {
    const service = new ApplicationTimeoutService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await service.cancelExpiredApplications();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ยกเลิกใบสมัครที่ยังไม่ส่งเอกสารเกิน 15 วัน", async () => {
    const service = new ApplicationTimeoutService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 5, userId: "student-1" }]),
    );

    await service.cancelExpiredApplications();

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "ABORT",
      isActive: false,
    });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "IDLE",
    });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      applicationStatusId: 5,
      oldStatus: "PENDING_DOCUMENT",
      newStatus: "ABORT",
    });
  });

  it("ไม่ throw ออกมาแม้เกิด error ระหว่างประมวลผล", async () => {
    const service = new ApplicationTimeoutService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(service.cancelExpiredApplications()).resolves.toBeUndefined();
  });
});
