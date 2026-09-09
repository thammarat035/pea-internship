import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: เลื่อนสถานะนักศึกษาจาก AWAITING (เอกสารครบแล้วแต่ยังไม่ถึงวัน
// เริ่มฝึกงาน) เป็น ACTIVE เมื่อถึงวันเริ่มงานจริงแล้ว — ต่างจาก cron อื่นๆ
// ตรงที่ตัวนี้ "ไม่ swallow error" (ไม่มี try/catch ครอบ ปล่อยให้ throw ออกไป
// ให้ระบบ cron scheduler จัดการเอง)
// ---------------------------------------------------------------------------

const mockSelect = mock();
const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock((_s?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  select: mockSelect,
  update: mockUpdate,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};
mock.module("@/db", () => ({ db: dbMock }));

const { AwaitingCronService } = await import("../service");

beforeEach(() => {
  mockSelect.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("AwaitingCronService.updateAwaitingToActive", () => {
  it("คืน updatedCount=0 เมื่อไม่มีนักศึกษาที่ถึงเวลาต้องเปลี่ยนสถานะ", async () => {
    const service = new AwaitingCronService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.updateAwaitingToActive();

    expect(result).toEqual({ success: true, updatedCount: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("เปลี่ยนสถานะนักศึกษาที่ถึงวันเริ่มงานแล้วเป็น ACTIVE ทุกคน", async () => {
    const service = new AwaitingCronService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationId: 1, userId: "student-1" },
        { applicationId: 2, userId: "student-2" },
      ]),
    );

    const result = await service.updateAwaitingToActive();

    expect(result).toEqual({ success: true, updatedCount: 2 });
    expect(mockUpdateSet).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ internshipStatus: "ACTIVE" });
  });

  it("throw error ออกไปตรงๆ เมื่อ query ล้มเหลว (ไม่กลืน error ทิ้งเหมือน cron อื่น)", async () => {
    const service = new AwaitingCronService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    expect(service.updateAwaitingToActive()).rejects.toThrow("db down");
  });
});
