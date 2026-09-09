import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส scope 3 ของ ApplicationService: ประวัติการสมัคร (getMyHistory,
// getStudentHistory, getAllStudentsHistory) — ทั้ง 3 เมธอดเป็น read-only ล้วนๆ
// ไม่มี insert/update เลย จึง mock harness เหลือแค่ mockSelect
// ---------------------------------------------------------------------------

const mockSelect = mock();

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

const dbMock = {
  select: mockSelect,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));
mock.module("@/lib/s3", () => ({
  s3Client: { send: mock(() => Promise.resolve({})) },
  BUCKET_NAME: "test-bucket",
}));
mock.module("@/modules/mail/service", () => ({
  MailService: class {},
}));
mock.module("@/modules/staff-logs/service", () => ({
  StaffLogsService: class {},
}));

const { ApplicationService } = await import("../service");
const { ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  mockSelect.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationService.getMyHistory", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.getMyHistory("user-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("คืน array ว่างทันทีเมื่อไม่มีใบสมัครเลย (ไม่ query เอกสารเพิ่ม)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getMyHistory("user-1");

    expect(result).toEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("จับกลุ่มเอกสารเข้ากับใบสมัครที่ถูกต้องตาม applicationId และ default invalidReasons เป็น []", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationId: 10, applicationStatus: "PENDING_DOCUMENT", internshipRound: 1 },
        { applicationId: 11, applicationStatus: "COMPLETE", internshipRound: 2 },
      ]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationStatusId: 10, docTypeId: 1, docFile: "a.pdf", validationStatus: "VERIFIED", invalidReasons: null, note: null },
        { applicationStatusId: 11, docTypeId: 1, docFile: "b.pdf", validationStatus: "INVALID", invalidReasons: ["ไฟล์เบลอ"], note: "แก้ไข" },
      ]),
    );

    const result = await service.getMyHistory("user-1");

    expect(result[0].documents).toEqual([
      { docTypeId: 1, docFile: "a.pdf", validationStatus: "VERIFIED", invalidReasons: [], note: null },
    ]);
    expect(result[1].documents).toEqual([
      { docTypeId: 1, docFile: "b.pdf", validationStatus: "INVALID", invalidReasons: ["ไฟล์เบลอ"], note: "แก้ไข" },
    ]);
  });

  it("ใบสมัครที่ไม่มีเอกสารเลยได้ documents เป็น array ว่าง", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ applicationId: 10, applicationStatus: "PENDING_DOCUMENT" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getMyHistory("user-1");

    expect(result[0].documents).toEqual([]);
  });
});

describe("ApplicationService.getStudentHistory", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ร้องขอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getStudentHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบนักศึกษาเป้าหมาย", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getStudentHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อนักศึกษาอยู่คนละแผนกกับผู้ร้องขอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 99 }]));

    expect(
      service.getStudentHistory("owner-1", "student-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Admin ที่ไม่มี departmentId ของตัวเอง ดูประวัตินักศึกษาแผนกไหนก็ได้ (ข้ามการเช็คแผนก)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1", departmentId: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ applicationId: 20, applicationStatus: "COMPLETE" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getStudentHistory("admin-1", "student-1");

    expect(result).toHaveLength(1);
  });

  it("ไม่ default invalidReasons เป็น [] เมื่อเป็น null (ต่างจาก getMyHistory)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ applicationId: 20, applicationStatus: "PENDING_DOCUMENT" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationStatusId: 20, docTypeId: 1, docFile: "a.pdf", validationStatus: "VERIFIED", invalidReasons: null, note: null },
      ]),
    );

    const result = await service.getStudentHistory("owner-1", "student-1");

    expect(result[0].documents[0].invalidReasons).toBeNull();
  });
});

describe("ApplicationService.getAllStudentsHistory", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ร้องขอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getAllStudentsHistory("user-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อ role ไม่ใช่ Admin(1) หรือ Owner(2)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));

    expect(
      service.getAllStudentsHistory("user-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อเป็น Owner(2) แต่ไม่มีสังกัดแผนก", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "owner-1", roleId: 2, departmentId: null }]),
    );

    expect(
      service.getAllStudentsHistory("owner-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("รวมเอกสารและ mentor เข้ากับใบสมัครที่ถูกต้อง พร้อมคำนวณ pagination", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "admin-1", roleId: 1, departmentId: null }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationId: 10, applicationStatus: "COMPLETE", fname: "สมชาย", lname: "ใจดี" },
      ]),
    ); // rows
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationStatusId: 10, docTypeId: 1, docFile: "a.pdf", validationStatus: "VERIFIED", invalidReasons: [] },
      ]),
    ); // allDocs
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { applicationStatusId: 10, mentorStaffId: 1, mentorFname: "พี่", mentorLname: "เลี้ยง", mentorEmail: "m@x.com", mentorPhone: "081" },
      ]),
    ); // allMentors
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 25 }])); // totalRow

    const result = await service.getAllStudentsHistory("admin-1", {
      page: 2,
      limit: 10,
    });

    expect(result.data[0].documents).toHaveLength(1);
    expect(result.data[0].mentors).toEqual([
      { fname: "พี่", lname: "เลี้ยง", email: "m@x.com", phone: "081" },
    ]);
    expect(result.meta).toEqual({
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
      hasNextPage: true,
    });
  });

  it("ข้ามการ query เอกสาร/mentor เมื่อไม่มีใบสมัครเลย และ hasNextPage เป็น false ในหน้าสุดท้าย", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "admin-1", roleId: 1, departmentId: null }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // rows ว่าง
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }])); // totalRow

    const result = await service.getAllStudentsHistory("admin-1", {
      page: 1,
      limit: 10,
    });

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
      hasNextPage: false,
    });
    // rows ว่าง -> ข้าม select เอกสารและ mentor ไปเลย เหลือแค่ 3 ครั้ง (req, rows, totalRow)
    expect(mockSelect).toHaveBeenCalledTimes(3);
  });
});
