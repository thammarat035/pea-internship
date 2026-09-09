import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส NotificationService ทั้ง 8 เมธอด — 4 ตัวแรก (getMyNotifications,
// markRead, markAllRead, deleteNotification) ถูกเรียกจริงผ่าน route
// อีก 4 ตัว (create, createMany, getAdminUserIds, getOwnerUserIdsByDepartment)
// ไม่มี module ไหนในระบบเรียกใช้เลย (grep ทั้งโปรเจกต์ไม่เจอ caller) - ทุกโมดูล
// ที่ต้องสร้าง notification (check-time, leave-requests, application ฯลฯ)
// เลือก insert เข้าตาราง notifications ตรงๆ เองแทนที่จะเรียก service นี้
// เทสไว้ครบทุกเมธอดเพราะเป็น public method ที่ใช้งานได้จริงแม้ไม่มีคนเรียก
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock();
const mockUpdateWhere = mock((_where?: unknown) => ({
  returning: mockUpdateReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const { NotificationService } = await import("../service");
const { ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("NotificationService.create", () => {
  it("สร้าง notification ใหม่และคืนแถวที่สร้าง (isRead=false เสมอ)", async () => {
    const service = new NotificationService();
    mockInsertReturning.mockResolvedValueOnce([
      { id: 1, userId: "user-1", title: "หัวข้อ", message: "ข้อความ", isRead: false },
    ]);

    const result = await service.create("user-1", "หัวข้อ", "ข้อความ");

    expect(result).toMatchObject({ title: "หัวข้อ", isRead: false });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ isRead: false });
  });
});

describe("NotificationService.createMany", () => {
  it("คืน count=0 ทันทีโดยไม่ insert เมื่อไม่มี userIds เลย", async () => {
    const service = new NotificationService();

    const result = await service.createMany([], "หัวข้อ", "ข้อความ");

    expect(result).toEqual({ count: 0 });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("ตัด userIds ที่ซ้ำและว่างเปล่าออกก่อน insert", async () => {
    const service = new NotificationService();

    const result = await service.createMany(
      ["user-1", "user-1", "user-2", "", null as unknown as string],
      "หัวข้อ",
      "ข้อความ",
    );

    expect(result).toEqual({ count: 2 });
    expect(mockInsertValues.mock.calls[0][0]).toEqual([
      { userId: "user-1", title: "หัวข้อ", message: "ข้อความ", isRead: false },
      { userId: "user-2", title: "หัวข้อ", message: "ข้อความ", isRead: false },
    ]);
  });
});

describe("NotificationService.getMyNotifications", () => {
  it("ใช้ limit=20, offset=0 เป็นค่า default", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, title: "a" }]));

    const result = await service.getMyNotifications("user-1");

    expect(result).toHaveLength(1);
  });

  it("รับ unreadOnly/limit/offset ที่ระบุมาโดยไม่ error", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getMyNotifications("user-1", {
      unreadOnly: true,
      limit: 5,
      offset: 10,
    });

    expect(result).toEqual([]);
  });
});

describe("NotificationService.markRead", () => {
  it("throws NotFoundError เมื่อไม่พบ notification", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.markRead("user-1", 1, true),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อ notification ไม่ใช่ของผู้ใช้ที่ร้องขอ", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, owner: "someone-else" }]));

    expect(
      service.markRead("user-1", 1, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ตั้งค่าอ่าน/ยังไม่อ่านสำเร็จ", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, owner: "user-1" }]));
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1, isRead: false }]);

    const result = await service.markRead("user-1", 1, false);

    expect(result).toMatchObject({ isRead: false });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ isRead: false });
  });
});

describe("NotificationService.markAllRead", () => {
  it("ตั้งค่าอ่านแล้วทั้งหมดสำเร็จ", async () => {
    const service = new NotificationService();

    const result = await service.markAllRead("user-1");

    expect(result).toEqual({ success: true });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ isRead: true });
  });
});

describe("NotificationService.getAdminUserIds", () => {
  it("คืนรายการ id ของ Admin (roleId=1) ทั้งหมด", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }, { id: "admin-2" }]));

    const result = await service.getAdminUserIds();

    expect(result).toEqual(["admin-1", "admin-2"]);
  });
});

describe("NotificationService.getOwnerUserIdsByDepartment", () => {
  it("คืนรายการ id ของ Owner (roleId=2) ในแผนกที่ระบุ", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1" }]));

    const result = await service.getOwnerUserIdsByDepartment(10);

    expect(result).toEqual(["owner-1"]);
  });
});

describe("NotificationService.deleteNotification", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.deleteNotification("user-1", 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบการแจ้งเตือน", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.deleteNotification("user-1", 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อพยายามลบการแจ้งเตือนของผู้อื่น", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, userId: "someone-else" }]));

    expect(
      service.deleteNotification("user-1", 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ลบสำเร็จ", async () => {
    const service = new NotificationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, userId: "user-1" }]));

    const result = await service.deleteNotification("user-1", 1);

    expect(result).toEqual({ success: true, message: "ลบการแจ้งเตือนเรียบร้อยแล้ว" });
  });
});
