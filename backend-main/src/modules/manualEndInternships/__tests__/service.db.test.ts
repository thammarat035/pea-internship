import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส OwnerStudentStatusService ทั้ง 2 เมธอด (getInternshipEndHistory,
// updateInternshipStatus) — ทั้งสองเมธอดมี guard clause ชุดเดียวกันเป๊ะ
// (owner ต้องเป็น Admin/Owner + มีสังกัดกอง, target ต้องเป็นนักศึกษากองเดียวกัน)
// ก่อนจะแยกเส้นทางไปทำงานจริง
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertValues = mock((_values?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
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

const mockSendEmail = mock(() => Promise.resolve());
mock.module("@/modules/mail/service", () => ({
  MailService: class {
    sendEmail = mockSendEmail;
    buildInternshipCanceledEmail = mock(() => ({ subject: "", html: "" }));
  },
}));

const { OwnerStudentStatusService } = await import("../service");
const { BadRequestError, ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

const OWNER = { roleId: 2, departmentId: 10 };
const STUDENT_USER = {
  id: "student-1",
  roleId: 3,
  departmentId: 10,
  fname: "สมชาย",
  lname: "ใจดี",
  email: "student1@example.com",
};
const ACTIVE_APP = {
  id: 50,
  positionId: 5,
  departmentId: 10,
  positionName: "Developer",
  departmentName: "ฝ่าย IT",
};

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockSendEmail.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("OwnerStudentStatusService.getInternshipEndHistory", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งานที่เรียก", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getInternshipEndHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้เรียกเป็นนักศึกษา (roleId=3)", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 3, departmentId: 10 }]));

    expect(
      service.getInternshipEndHistory("student-x", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อ Owner ไม่มีสังกัดกอง", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 2, departmentId: null }]));

    expect(
      service.getInternshipEndHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบนักศึกษาเป้าหมาย", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getInternshipEndHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อ user เป้าหมายไม่ใช่นักศึกษา", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-2", roleId: 2, departmentId: 10 }]));

    expect(
      service.getInternshipEndHistory("owner-1", "owner-2"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws ForbiddenError เมื่อนักศึกษาอยู่คนละกองกับ Owner", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "student-1", roleId: 3, departmentId: 99 }]));

    expect(
      service.getInternshipEndHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "student-1", roleId: 3, departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getInternshipEndHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("คืนประวัติการจบฝึกงานพร้อมชื่อผู้เปลี่ยนสถานะ", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "student-1", roleId: 3, departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 1, status: "COMPLETE", reason: null, createdAt: new Date(), changedBy: "owner-1", fname: "พี่", lname: "เลี้ยง" },
      ]),
    );

    const result = await service.getInternshipEndHistory("owner-1", "student-1");

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("COMPLETE");
  });
});

describe("OwnerStudentStatusService.updateInternshipStatus", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งานที่เรียก", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.updateInternshipStatus("owner-1", "student-1", { status: "COMPLETE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อ user เป้าหมายไม่ใช่นักศึกษา", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-2", roleId: 2, departmentId: 10 }]));

    expect(
      service.updateInternshipStatus("owner-1", "owner-2", { status: "COMPLETE" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.updateInternshipStatus("owner-1", "student-1", { status: "COMPLETE" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อสถานะปัจจุบันไม่ใช่ ACTIVE/AWAITING/EXTENDED", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, internshipStatus: "IDLE" }]));

    expect(
      service.updateInternshipStatus("owner-1", "student-1", { status: "COMPLETE" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อไม่พบใบสมัคร active ของนักศึกษา", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, internshipStatus: "ACTIVE" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.updateInternshipStatus("owner-1", "student-1", { status: "COMPLETE" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อ CANCEL โดยไม่ระบุเหตุผล", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, internshipStatus: "ACTIVE" }]));
    mockSelect.mockReturnValueOnce(makeChainable([ACTIVE_APP]));

    expect(
      service.updateInternshipStatus("owner-1", "student-1", { status: "CANCEL" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("CANCEL สำเร็จ: ลดโควตาตำแหน่ง คืนสถานะ CANCEL พร้อมเหตุผล แจ้งเตือน และส่งอีเมล", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, internshipStatus: "ACTIVE" }]));
    mockSelect.mockReturnValueOnce(makeChainable([ACTIVE_APP]));

    const result = await service.updateInternshipStatus("owner-1", "student-1", {
      status: "CANCEL",
      reason: "  ทำผิดวินัยร้ายแรง  ",
    });

    expect(result).toEqual({ studentUserId: "student-1", internshipStatus: "CANCEL" });
    // update 0 = internshipPositions (ลดโควตา), 1 = studentProfiles, 2 = applicationStatuses
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "CANCEL",
      statusNote: "ทำผิดวินัยร้ายแรง", // ต้อง trim() แล้ว
    });
    expect(mockUpdateSet.mock.calls[2][0]).toMatchObject({
      applicationStatus: "CANCEL",
      isActive: false,
    });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      status: "CANCEL",
      reason: "ทำผิดวินัยร้ายแรง",
      changedBy: "owner-1",
    });
    const notificationPayload = mockInsertValues.mock.calls[1][0] as { title: string };
    expect(notificationPayload.title).toBe("การฝึกงานถูกยกเลิก");
  });

  it("COMPLETE สำเร็จ: ลดโควตาตำแหน่ง คืนสถานะ COMPLETE โดยไม่ต้องมีเหตุผล และไม่ส่งอีเมล", async () => {
    const service = new OwnerStudentStatusService();
    mockSelect.mockReturnValueOnce(makeChainable([OWNER]));
    mockSelect.mockReturnValueOnce(makeChainable([STUDENT_USER]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, internshipStatus: "AWAITING" }]));
    mockSelect.mockReturnValueOnce(makeChainable([ACTIVE_APP]));

    const result = await service.updateInternshipStatus("owner-1", "student-1", {
      status: "COMPLETE",
    });

    expect(result).toEqual({ studentUserId: "student-1", internshipStatus: "COMPLETE" });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({ internshipStatus: "COMPLETE" });
    expect(mockUpdateSet.mock.calls[2][0]).toMatchObject({ isActive: false });
    expect(mockUpdateSet.mock.calls[2][0]).not.toHaveProperty("applicationStatus");
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ status: "COMPLETE", reason: null });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
