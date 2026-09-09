import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: อัปเดตสถานะประกาศรับสมัคร (recruitmentStatus) อัตโนมัติตาม
// วันที่ - เปิดรับ (NOT_OPEN_YET -> OPEN) เมื่อถึงวัน recruitStart, และหมดอายุ
// (OPEN/CLOSE -> EXPIRED) เมื่อเลย recruitEnd ไปแล้ว ทั้งสอง query/update เป็น
// อิสระต่อกัน (ตำแหน่งหนึ่งอาจเข้าเงื่อนไขได้แค่ทางเดียวในรอบเดียวเท่านั้น
// เพราะสถานะต้นทางไม่ overlap กัน: NOT_OPEN_YET vs OPEN/CLOSE)
// ---------------------------------------------------------------------------

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

const mockSelect = mock();

const dbMock = {
  select: mockSelect,
  update: mockUpdate,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};
mock.module("@/db", () => ({ db: dbMock }));

const { PositionStatusCronService } = await import("../service");

beforeEach(() => {
  mockSelect.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("PositionStatusCronService.updatePositionStatuses", () => {
  it("ไม่มีตำแหน่งไหนต้องเปิด/หมดอายุเลย -> ไม่ update อะไร คืน count เป็น 0 ทั้งคู่", async () => {
    const service = new PositionStatusCronService();
    mockSelect.mockReturnValueOnce(makeChainable([])); // toOpen
    mockSelect.mockReturnValueOnce(makeChainable([])); // toExpire

    const result = await service.updatePositionStatuses();

    expect(result).toEqual({ success: true, openedCount: 0, expiredCount: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("เปิดรับสมัครตำแหน่งที่ถึงวัน recruitStart แล้ว (NOT_OPEN_YET -> OPEN)", async () => {
    const service = new PositionStatusCronService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }, { id: 2 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.updatePositionStatuses();

    expect(result.openedCount).toBe(2);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ recruitmentStatus: "OPEN" });
  });

  it("ปิดหมดอายุตำแหน่งที่เลยวัน recruitEnd แล้ว (OPEN/CLOSE -> EXPIRED)", async () => {
    const service = new PositionStatusCronService();
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5 }]));

    const result = await service.updatePositionStatuses();

    expect(result.expiredCount).toBe(1);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ recruitmentStatus: "EXPIRED" });
  });

  it("ทำทั้งสองอย่างพร้อมกันได้ในรอบเดียวเมื่อมีทั้งตำแหน่งที่ต้องเปิดและหมดอายุ", async () => {
    const service = new PositionStatusCronService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5 }]));

    const result = await service.updatePositionStatuses();

    expect(result).toEqual({ success: true, openedCount: 1, expiredCount: 1 });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("throw error ออกไปตรงๆ หลัง log แล้ว (ไม่กลืน error ทิ้ง)", async () => {
    const service = new PositionStatusCronService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    expect(service.updatePositionStatuses()).rejects.toThrow("db down");
  });
});
