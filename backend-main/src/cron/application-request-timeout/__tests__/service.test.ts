import { afterAll, afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: ยกเลิกใบสมัครที่ค้างสถานะ PENDING_REQUEST (รอส่งเอกสารขอความ
// อนุเคราะห์) นานเกินไป — timeout ไม่คงที่ ขึ้นกับว่าผู้สมัคร "เพิ่งถูกตีกลับ
// จาก PENDING_REVIEW" หรือไม่ (15 วัน) หรือเป็นครั้งแรก (30 วัน) และอ้างอิง
// เวลาจาก action ล่าสุดที่เข้าสถานะนี้ (ไม่ใช่ createdAt เดิมของใบสมัคร)
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
  chain.orderBy = () => chain;
  chain.limit = () => chain;
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

const { ApplicationRequestTimeoutService } = await import("../service");

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

describe("ApplicationRequestTimeoutService.abortExpiredPendingRequests", () => {
  it("ไม่ทำอะไรเลยเมื่อไม่มีใบสมัครค้างสถานะ PENDING_REQUEST", async () => {
    const service = new ApplicationRequestTimeoutService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await service.abortExpiredPendingRequests();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ข้ามใบสมัครที่ยังไม่ครบ 30 วัน (นับจาก action ล่าสุดที่เข้าสถานะนี้)", async () => {
    const service = new ApplicationRequestTimeoutService();
    setSystemTime(new Date(2025, 5, 10));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "student-1", createdAt: new Date(2025, 5, 1), updatedAt: new Date(2025, 5, 1) }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 100, oldStatus: "PENDING_DOCUMENT", newStatus: "PENDING_REQUEST", createdAt: new Date(2025, 5, 5) }]),
    );

    await service.abortExpiredPendingRequests();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ยกเลิกใบสมัครที่เกิน 30 วันแล้ว (กรณีปกติ ไม่เคยถูกตีกลับจาก PENDING_REVIEW)", async () => {
    const service = new ApplicationRequestTimeoutService();
    setSystemTime(new Date(2025, 6, 10)); // 10 ก.ค.
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "student-1", createdAt: new Date(2025, 5, 1), updatedAt: new Date(2025, 5, 1) }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 100, oldStatus: "PENDING_DOCUMENT", newStatus: "PENDING_REQUEST", createdAt: new Date(2025, 5, 1) }]),
    ); // เข้าสถานะนี้ตั้งแต่ 1 มิ.ย. -> ครบ 30 วันไปนานแล้ว ณ 10 ก.ค.

    await service.abortExpiredPendingRequests();

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ applicationStatus: "ABORT" });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      applicationStatusId: 1,
      oldStatus: "PENDING_REQUEST",
      newStatus: "ABORT",
    });
  });

  it("ใช้ timeout 15 วัน (สั้นกว่าปกติ) เมื่อกลับเข้ามาจากสถานะ PENDING_REVIEW (เอกสารเคยถูกตีกลับ)", async () => {
    const service = new ApplicationRequestTimeoutService();
    setSystemTime(new Date(2025, 5, 20)); // 20 มิ.ย. -> ผ่านมา 18 วันจาก 2 มิ.ย. (เกิน 15 วันแล้ว แต่ไม่เกิน 30)
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "student-1", createdAt: new Date(2025, 4, 1), updatedAt: new Date(2025, 5, 2) }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 100, oldStatus: "PENDING_REVIEW", newStatus: "PENDING_REQUEST", createdAt: new Date(2025, 5, 2) }]),
    );

    await service.abortExpiredPendingRequests();

    // ถ้าใช้ timeout 30 วันผิดๆ จะยังไม่หมดอายุ (ไม่ update) แต่ที่ถูกต้องคือ 15 วัน -> ต้องหมดอายุแล้ว
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ applicationStatus: "ABORT" });
  });

  it("ใช้ updatedAt ของใบสมัครเป็น fallback เมื่อไม่มีประวัติ action เข้าสถานะนี้เลย", async () => {
    const service = new ApplicationRequestTimeoutService();
    setSystemTime(new Date(2025, 6, 10));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "student-1", createdAt: new Date(2025, 4, 1), updatedAt: new Date(2025, 5, 1) }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // ไม่มีประวัติ action เลย

    await service.abortExpiredPendingRequests();

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ applicationStatus: "ABORT" });
  });

  it("ไม่ throw ออกมาแม้เกิด error ระหว่างประมวลผล", async () => {
    const service = new ApplicationRequestTimeoutService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(service.abortExpiredPendingRequests()).resolves.toBeUndefined();
  });
});
