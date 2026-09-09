import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส StaffLogsService: log(conn, userId, action) พิเศษตรงที่รับ "connection"
// (db หรือ tx) เป็นพารามิเตอร์แรกเข้ามาเอง (ให้โมดูลอื่นส่ง tx ของตัวเองเข้ามา
// เพื่อให้ log อยู่ใน transaction เดียวกับ action ที่กำลังทำ) จึงเทสได้โดยส่ง
// mock connection ของเราเองตรงๆ ไม่ต้อง mock "@/db" เลยสำหรับเมธอดนี้
// ---------------------------------------------------------------------------

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeFakeConn(userRow: unknown) {
  const mockSelect = mock(() => makeChainable(userRow ? [userRow] : []));
  const mockInsertValues = mock((_values?: unknown) => Promise.resolve());
  const mockInsert = mock(() => ({ values: mockInsertValues }));
  return { conn: { select: mockSelect, insert: mockInsert }, mockInsertValues, mockInsert };
}

const mockSelect = mock();
const dbMock = { select: mockSelect };
mock.module("@/db", () => ({ db: dbMock }));

const { StaffLogsService } = await import("../service");
const { ForbiddenError } = await import("@/common/exceptions");

beforeEach(() => {
  mockSelect.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("StaffLogsService.log", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new StaffLogsService();
    const { conn } = makeFakeConn(undefined);

    expect(
      service.log(conn as never, "user-1", "DID_SOMETHING"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานไม่ใช่ Admin/Owner", async () => {
    const service = new StaffLogsService();
    const { conn } = makeFakeConn({ id: "student-1", roleId: 3 });

    expect(
      service.log(conn as never, "student-1", "DID_SOMETHING"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("บันทึก log สำเร็จเมื่อผู้ใช้เป็น Admin หรือ Owner", async () => {
    const service = new StaffLogsService();
    const { conn, mockInsertValues } = makeFakeConn({ id: "admin-1", roleId: 1 });

    await service.log(conn as never, "admin-1", "CREATE_POSITION positionId=1");

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      userId: "admin-1",
      action: "CREATE_POSITION positionId=1",
    });
  });
});

describe("StaffLogsService.findAll", () => {
  it("throws ForbiddenError เมื่อผู้ร้องขอไม่ใช่ Admin/Owner", async () => {
    const service = new StaffLogsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 3 }]));

    expect(
      service.findAll("student-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("คืนรายการ log พร้อมข้อมูลผู้กระทำที่ join มา", async () => {
    const service = new StaffLogsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, action: "CREATE_POSITION", fname: "สมชาย", lname: "ใจดี" }]),
    );

    const result = await service.findAll("admin-1", { userId: "user-1" });

    expect(result).toHaveLength(1);
  });
});
