import { afterAll, afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: ยกเลิกใบสมัครที่ค้างอยู่สถานะ PENDING_INTERVIEW เกิน 30 วัน
// (เจ้าหน้าที่ไม่นัดสัมภาษณ์ให้ทันเวลา) — งานนี้ swallow error เอง
// (try/catch ครอบทั้งเมธอด ไม่ throw ออกมา) เพราะเป็น background job ที่ต้อง
// ไม่ทำให้ scheduler ทั้งระบบล้มถ้ามีแถวใดแถวหนึ่งมีปัญหา
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

const { ApplicationInterviewTimeoutService } = await import("../service");

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationInterviewTimeoutService.abortExpiredPendingInterviewApplications", () => {
  it("ไม่ทำอะไรเลยเมื่อไม่มีใบสมัครที่หมดเวลา", async () => {
    const service = new ApplicationInterviewTimeoutService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await service.abortExpiredPendingInterviewApplications();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ยกเลิกใบสมัครที่ค้างเกิน 30 วัน: อัปเดตสถานะ คืนนักศึกษาเป็น IDLE และบันทึกประวัติ", async () => {
    const service = new ApplicationInterviewTimeoutService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "student-1" }]),
    );

    await service.abortExpiredPendingInterviewApplications();

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "ABORT",
      isActive: false,
    });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "IDLE",
    });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      applicationStatusId: 10,
      actionBy: "system",
      oldStatus: "PENDING_INTERVIEW",
      newStatus: "ABORT",
    });
  });

  it("ประมวลผลใบสมัครหลายใบต่อเนื่องกันได้ในรอบเดียว", async () => {
    const service = new ApplicationInterviewTimeoutService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 10, userId: "student-1" },
        { id: 11, userId: "student-2" },
      ]),
    );

    await service.abortExpiredPendingInterviewApplications();

    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("ไม่ throw ออกมาแม้ query ล้มเหลว (กัน scheduler ทั้งระบบล้ม)", async () => {
    const service = new ApplicationInterviewTimeoutService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(
      service.abortExpiredPendingInterviewApplications(),
    ).resolves.toBeUndefined();
  });
});
