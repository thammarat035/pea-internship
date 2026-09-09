import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส ApplicationStatusActionService: create (insert wrapper ง่ายๆ),
// getByApplicationStatusId (มี 3-way permission check: เจ้าของใบสมัคร /
// admin / owner แผนกเดียวกัน) และ getMyActions (list ของตัวเอง)
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = { select: mockSelect, insert: mockInsert };
mock.module("@/db", () => ({ db: dbMock }));

const { ApplicationStatusActionService } = await import("../service");
const { ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationStatusActionService.create", () => {
  it("insert แถวใหม่และคืนแถวที่สร้างจาก returning()", async () => {
    const service = new ApplicationStatusActionService();
    const createdAt = new Date("2025-06-16T00:00:00Z");
    mockInsertReturning.mockResolvedValueOnce([
      { id: 1, applicationStatusId: 10, actionBy: "user-1", oldStatus: null, newStatus: "PENDING_DOCUMENT", createdAt },
    ]);

    const result = await service.create({
      applicationStatusId: 10,
      actionBy: "user-1",
      oldStatus: null,
      newStatus: "PENDING_DOCUMENT",
    });

    expect(result).toMatchObject({
      id: 1,
      applicationStatusId: 10,
      actionBy: "user-1",
      oldStatus: null,
      newStatus: "PENDING_DOCUMENT",
    });
  });
});

describe("ApplicationStatusActionService.getByApplicationStatusId", () => {
  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getByApplicationStatusId("user-1", 10),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อไม่พบผู้ร้องขอ", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getByApplicationStatusId("user-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้ร้องขอไม่ใช่เจ้าของ ไม่ใช่ Admin และไม่ใช่ Owner แผนกเดียวกัน", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "other-student", roleId: 3, departmentId: 5 }]),
    );

    expect(
      service.getByApplicationStatusId("other-student", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อเป็น Owner แต่คนละแผนกกับใบสมัคร", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "owner-1", roleId: 2, departmentId: 99 }]),
    );

    expect(
      service.getByApplicationStatusId("owner-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("นักศึกษาเจ้าของใบสมัครดูประวัติตัวเองได้ พร้อมข้อมูลผู้กระทำที่ join มา", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "student-1", roleId: 3, departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          id: 1,
          applicationStatusId: 10,
          oldStatus: "PENDING_DOCUMENT",
          newStatus: "PENDING_INTERVIEW",
          actor: { id: "student-1", fname: "สมชาย", lname: "ใจดี" },
        },
      ]),
    );

    const result = await service.getByApplicationStatusId("student-1", 10);

    expect(result).toHaveLength(1);
    expect(result[0].actor.fname).toBe("สมชาย");
  });

  it("Admin ดูประวัติของใบสมัครใครก็ได้ ไม่ว่าจะแผนกไหน", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "admin-1", roleId: 1, departmentId: 999 }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await expect(
      service.getByApplicationStatusId("admin-1", 10),
    ).resolves.toEqual([]);
  });

  it("Owner แผนกเดียวกันดูประวัติของนักศึกษาในแผนกตนได้", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "student-1", departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "owner-1", roleId: 2, departmentId: 5 }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await expect(
      service.getByApplicationStatusId("owner-1", 10),
    ).resolves.toEqual([]);
  });
});

describe("ApplicationStatusActionService.getMyActions", () => {
  it("คืนรายการ action ที่ตัวเองทำ", async () => {
    const service = new ApplicationStatusActionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 1, applicationStatusId: 10, oldStatus: null, newStatus: "PENDING_DOCUMENT" },
      ]),
    );

    const result = await service.getMyActions("user-1");

    expect(result).toHaveLength(1);
  });
});
