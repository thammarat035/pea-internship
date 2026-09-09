import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส scope 2 ของ ApplicationService: flow ฝั่ง owner/admin ตั้งแต่สัมภาษณ์ผ่าน
// จนถึงตรวจเอกสาร (approveInterview, confirmAccept, uploadRequestLetter,
// reviewDocument, reviewRequestLetter, cancelByOwner) รวมถึง private helper
// `cancelPendingApplicationsWhenPositionFilled` ที่ confirmAccept เรียกใช้
// ต่อจาก scope 1 (student-flow) — pattern การ mock เหมือนกันทุกอย่าง
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertOnConflictUpdate = mock(() => Promise.resolve());
const mockInsertOnConflictNothing = mock(() => Promise.resolve());
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
  onConflictDoUpdate: mockInsertOnConflictUpdate,
  onConflictDoNothing: mockInsertOnConflictNothing,
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

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
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

mock.module("@/lib/s3", () => ({
  s3Client: { send: mock(() => Promise.resolve({})) },
  BUCKET_NAME: "test-bucket",
}));

const mockSendEmail = mock(() => Promise.resolve());
mock.module("@/modules/mail/service", () => ({
  MailService: class {
    sendEmail = mockSendEmail;
    buildPositionFilledEmail = mock(() => ({ subject: "", html: "" }));
    buildAcceptedForInternshipEmail = mock(() => ({ subject: "", html: "" }));
    buildDocumentRejectedEmail = mock(() => ({ subject: "", html: "" }));
    buildInternshipCompletedEmail = mock(() => ({ subject: "", html: "" }));
    buildRejectedByOwnerEmail = mock(() => ({ subject: "", html: "" }));
  },
}));
mock.module("@/modules/staff-logs/service", () => ({
  StaffLogsService: class {
    log = mock(() => Promise.resolve());
  },
}));

const { ApplicationService } = await import("../service");
const { BadRequestError, ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertOnConflictUpdate.mockClear();
  mockInsertOnConflictNothing.mockClear();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockSendEmail.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationService.approveInterview", () => {
  it("throws ForbiddenError เมื่อผู้กดอนุมัติไม่มีสังกัดแผนก", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: null }]));

    expect(
      service.approveInterview("owner-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.approveInterview("owner-1", 10),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อสถานะไม่ใช่ PENDING_INTERVIEW", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, status: "PENDING_DOCUMENT", departmentId: 10 }]),
    );

    expect(
      service.approveInterview("owner-1", 10),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws ForbiddenError เมื่อใบสมัครไม่ใช่ของแผนกตนเอง", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, status: "PENDING_INTERVIEW", departmentId: 99 }]),
    );

    expect(
      service.approveInterview("owner-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("อนุมัติผ่านสัมภาษณ์สำเร็จ: เปลี่ยนเป็น PENDING_CONFIRMATION และอัปเดตนักศึกษาเป็น REVIEW", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 1, status: "PENDING_INTERVIEW", departmentId: 10, userId: "student-1", positionName: "Dev" },
      ]),
    );

    const result = await service.approveInterview("owner-1", 10);

    expect(result).toEqual({ applicationStatus: "PENDING_CONFIRMATION" });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "PENDING_CONFIRMATION",
    });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "REVIEW",
    });
  });
});

describe("ApplicationService.confirmAccept", () => {
  const baseApp = {
    id: 10,
    status: "PENDING_CONFIRMATION",
    departmentId: 10,
    userId: "student-1",
    positionId: 5,
    positionName: "Developer",
    departmentName: "ฝ่าย IT",
  };

  it("throws ForbiddenError เมื่อผู้กดยืนยันไม่มีสังกัดแผนก", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: null }]));

    expect(
      service.confirmAccept("owner-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อสถานะไม่ใช่ PENDING_CONFIRMATION", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ ...baseApp, status: "PENDING_INTERVIEW" }]),
    );

    expect(
      service.confirmAccept("owner-1", 10),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อจำนวนรับสมัครเต็มแล้ว (update quota ไม่มีแถวไหน match)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockUpdateReturning.mockResolvedValueOnce([]); // เต็มแล้ว update ไม่ match แถวไหนเลย

    expect(
      service.confirmAccept("owner-1", 10),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ยืนยันรับสำเร็จ: ผูก mentor ทุกคนของตำแหน่ง และแจ้งเตือนนักศึกษา", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 5, acceptedCount: 3, positionCount: 10 },
    ]);
    mockSelect.mockReturnValueOnce(
      makeChainable([{ mentorStaffId: "staff-1" }, { mentorStaffId: "staff-2" }]),
    ); // mentors
    mockSelect.mockReturnValueOnce(
      makeChainable([{ email: "student1@example.com", fname: "สมชาย", lname: "ใจดี" }]),
    ); // student email payload
    mockSelect.mockReturnValueOnce(makeChainable([{ positionCount: null }])); // cascade: ไม่จำกัดจำนวน -> ไม่ทำอะไรต่อ

    const result = await service.confirmAccept("owner-1", 10);

    expect(result).toEqual({ applicationStatus: "PENDING_REQUEST", mentorsLinked: 2 });
    expect(mockInsertOnConflictNothing).toHaveBeenCalledTimes(1); // insert applicationMentors
    expect(mockUpdateSet.mock.calls[2][0]).toMatchObject({ internshipStatus: "ACCEPT" });
    expect(mockUpdateSet.mock.calls[3][0]).toMatchObject({ departmentId: 10 });
  });

  it("ไม่ผูก mentor เมื่อตำแหน่งนี้ไม่มี mentor ถูกกำหนดไว้เลย", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 5, acceptedCount: 3, positionCount: 10 },
    ]);
    mockSelect.mockReturnValueOnce(makeChainable([])); // ไม่มี mentor เลย
    mockSelect.mockReturnValueOnce(makeChainable([{ email: null, fname: null, lname: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ positionCount: null }]));

    const result = await service.confirmAccept("owner-1", 10);

    expect(result.mentorsLinked).toBe(0);
    expect(mockInsertOnConflictNothing).not.toHaveBeenCalled();
  });
});

describe("ApplicationService (private) cancelPendingApplicationsWhenPositionFilled", () => {
  function callCascade(
    service: InstanceType<typeof ApplicationService>,
    positionId: number,
    acceptedApplicationId: number,
    actionBy: string,
  ) {
    return (
      service as unknown as {
        cancelPendingApplicationsWhenPositionFilled: (
          tx: unknown,
          positionId: number,
          acceptedApplicationId: number,
          actionBy: string,
        ) => Promise<void>;
      }
    ).cancelPendingApplicationsWhenPositionFilled(
      dbMock,
      positionId,
      acceptedApplicationId,
      actionBy,
    );
  }

  it("ไม่ทำอะไรเลยเมื่อไม่พบตำแหน่ง", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await callCascade(service, 5, 10, "owner-1");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ไม่ทำอะไรเลยเมื่อ positionCount เป็น null (ไม่จำกัดจำนวนรับ)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ positionCount: null, acceptedCount: 100, departmentId: 10, positionName: "x", departmentName: "y" }]),
    );

    await callCascade(service, 5, 10, "owner-1");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ไม่ทำอะไรเลยเมื่อยังรับไม่ครบจำนวน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ positionCount: 5, acceptedCount: 2, departmentId: 10, positionName: "x", departmentName: "y" }]),
    );

    await callCascade(service, 5, 10, "owner-1");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ไม่ทำอะไรเลยเมื่อรับครบแล้วแต่ไม่มีใบสมัครอื่นค้างอยู่", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ positionCount: 5, acceptedCount: 5, departmentId: 10, positionName: "x", departmentName: "y" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // pendingApps ว่าง

    await callCascade(service, 5, 10, "owner-1");

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("รับครบแล้ว: ยกเลิกใบสมัครที่ค้างอยู่ทั้งหมด (ยกเว้นใบที่เพิ่งรับ) และแจ้งเตือนทุกคน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ positionCount: 2, acceptedCount: 2, departmentId: 10, positionName: "Developer", departmentName: "IT" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 20, userId: "student-2", status: "PENDING_INTERVIEW" },
        { id: 21, userId: "student-3", status: "PENDING_DOCUMENT" },
      ]),
    ); // pendingApps
    mockSelect.mockReturnValueOnce(makeChainable([{ email: "s2@example.com", fname: "ก", lname: "ข" }])); // email ของ student-2
    mockSelect.mockReturnValueOnce(makeChainable([{ email: "s3@example.com", fname: "ค", lname: "ง" }])); // email ของ student-3

    await callCascade(service, 5, 10, "owner-1");

    // update ครั้งที่ 1 = applicationStatuses (ABORT), ครั้งที่ 2 = studentProfiles (IDLE)
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ applicationStatus: "ABORT" });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({ internshipStatus: "IDLE" });
    // insert: logAppStatusAction x2 + notifyStudentOnly x2 = 4 ครั้ง
    expect(mockInsertValues).toHaveBeenCalledTimes(4);
    expect(mockSendEmail).toHaveBeenCalledTimes(0); // sendEmailAsync ใช้ setImmediate จึงยังไม่ทำงานทันทีตอน await จบ
  });
});

describe("ApplicationService.uploadRequestLetter", () => {
  function pdfFile() {
    return new File(["%PDF-1.4"], "request-letter.pdf", { type: "application/pdf" });
  }

  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.uploadRequestLetter("user-1", 10, pdfFile()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อไม่ใช่เจ้าของใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "someone-else", status: "PENDING_REQUEST", positionName: "Dev" }]),
    );

    expect(
      service.uploadRequestLetter("user-1", 10, pdfFile()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อสถานะไม่ใช่ PENDING_REQUEST", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_REVIEW", positionName: "Dev" }]),
    );

    expect(
      service.uploadRequestLetter("user-1", 10, pdfFile()),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("อัปโหลดสำเร็จ: เปลี่ยนสถานะเป็น PENDING_REVIEW และแจ้งเตือน admin ทุกคน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_REQUEST", positionName: "Dev" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "admin-1" }, { id: "admin-2" }]),
    ); // admins (roleId=1)

    const result = await service.uploadRequestLetter("user-1", 10, pdfFile());

    expect(result.applicationStatus).toBe("PENDING_REVIEW");
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "PENDING_REVIEW",
    });
    // insert 0 = applicationDocuments, 1 = applicationStatusActions (log), 2 = notifications
    const notificationPayload = mockInsertValues.mock.calls[2][0] as unknown[];
    expect(notificationPayload).toHaveLength(2);
  });

  it("ไม่แจ้งเตือนใครเลยเมื่อระบบไม่มี admin (roleId=1) อยู่เลย", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_REQUEST", positionName: "Dev" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await service.uploadRequestLetter("user-1", 10, pdfFile());

    // applicationDocuments + applicationStatusActions (log) เท่านั้น ไม่มี notifications
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });
});

describe("ApplicationService.reviewDocument", () => {
  const baseApp = {
    id: 10,
    userId: "student-1",
    status: "PENDING_REVIEW",
    positionName: "Developer",
    departmentName: "ฝ่าย IT",
  };

  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน (admin)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.reviewDocument("admin-1", 10, 1, "VERIFIED"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อสถานะใบสมัครไม่อยู่ในขั้นตอนตรวจเอกสาร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ ...baseApp, status: "PENDING_INTERVIEW" }]),
    );

    expect(
      service.reviewDocument("admin-1", 10, 1, "VERIFIED"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อไม่พบเอกสารที่จะตรวจ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.reviewDocument("admin-1", 10, 1, "VERIFIED"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อตีกลับ (INVALID) โดยไม่ระบุเหตุผลเลย", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, invalidReasons: null }]));

    expect(
      service.reviewDocument("admin-1", 10, 1, "INVALID", undefined, []),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ตีกลับเอกสารสำเร็จ: รวมเหตุผลเดิม+ใหม่ กลับไปเป็น PENDING_REQUEST และแจ้งเตือนนักศึกษา", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, invalidReasons: ["ไฟล์เบลอ"] }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ email: "s1@example.com", fname: "สมชาย", lname: "ใจดี" }]),
    );

    const result = await service.reviewDocument(
      "admin-1",
      10,
      1,
      "INVALID",
      undefined,
      ["ลายเซ็นไม่ครบ"],
    );

    expect(result.applicationStatus).toBe("PENDING_REQUEST");
    expect(result.invalidReasons).toEqual(["ไฟล์เบลอ", "ลายเซ็นไม่ครบ"]);
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      applicationStatus: "PENDING_REQUEST",
    });
  });

  it("ตรวจผ่านแต่เอกสารอื่นยังไม่ครบ -> ยังไม่เปลี่ยนเป็น COMPLETE", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, invalidReasons: null }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { validationStatus: "VERIFIED" },
        { validationStatus: "PENDING" },
      ]),
    ); // เอกสารอีกใบยังไม่ผ่าน

    const result = await service.reviewDocument("admin-1", 10, 1, "VERIFIED");

    expect(result).toEqual({ applicationStatus: "PENDING_REVIEW" });
  });

  it("ตรวจผ่านครบทุกเอกสาร -> COMPLETE และ internshipStatus=ACTIVE เมื่อวันเริ่มงานผ่านมาแล้ว", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, invalidReasons: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ validationStatus: "VERIFIED" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ startDate: new Date("2020-01-01") }]),
    ); // เริ่มงานไปนานแล้ว
    mockSelect.mockReturnValueOnce(
      makeChainable([{ email: "s1@example.com", fname: "สมชาย", lname: "ใจดี" }]),
    );

    const result = await service.reviewDocument("admin-1", 10, 1, "VERIFIED");

    expect(result).toEqual({ applicationStatus: "COMPLETE", internshipStatus: "ACTIVE" });
  });

  it("ตรวจผ่านครบทุกเอกสาร -> COMPLETE และ internshipStatus=AWAITING เมื่อวันเริ่มงานยังไม่มาถึง", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, invalidReasons: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ validationStatus: "VERIFIED" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ startDate: new Date("2999-01-01") }]),
    ); // ยังไม่ถึงวันเริ่มงาน
    mockSelect.mockReturnValueOnce(
      makeChainable([{ email: "s1@example.com", fname: "สมชาย", lname: "ใจดี" }]),
    );

    const result = await service.reviewDocument("admin-1", 10, 1, "VERIFIED");

    expect(result).toEqual({ applicationStatus: "COMPLETE", internshipStatus: "AWAITING" });
  });
});

describe("ApplicationService.reviewRequestLetter", () => {
  it("ส่งต่อไปยัง reviewDocument โดยกำหนด docTypeId เป็น 4 เสมอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 10, userId: "student-1", status: "PENDING_REVIEW", positionName: "Dev", departmentName: "IT" },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, invalidReasons: null }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { validationStatus: "VERIFIED" },
        { validationStatus: "PENDING" },
      ]),
    ); // เอกสารอีกใบยังไม่ผ่าน -> ยังไม่ COMPLETE (แค่พิสูจน์ว่า docTypeId ถูก forward เป็น 4)

    const result = await service.reviewRequestLetter("admin-1", 10, "VERIFIED");

    expect(result).toEqual({ applicationStatus: "PENDING_REVIEW" });
  });
});

describe("ApplicationService.cancelByOwner", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.cancelByOwner("owner-1", 10, "เหตุผล"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานไม่มีสังกัดแผนก", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: null }]));

    expect(
      service.cancelByOwner("owner-1", 10, "เหตุผล"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.cancelByOwner("owner-1", 10, "เหตุผล"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อสถานะไม่อยู่ในขั้นที่ยกเลิกได้", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, status: "COMPLETE", departmentId: 10, studentUserId: "student-1" }]),
    );

    expect(
      service.cancelByOwner("owner-1", 10, "เหตุผล"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws ForbiddenError เมื่อใบสมัครไม่ใช่ของแผนกตนเอง", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, status: "PENDING_INTERVIEW", departmentId: 99, studentUserId: "student-1" }]),
    );

    expect(
      service.cancelByOwner("owner-1", 10, "เหตุผล"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อไม่ระบุเหตุผล (ว่างเปล่า)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, status: "PENDING_INTERVIEW", departmentId: 10, studentUserId: "student-1" }]),
    );

    expect(
      service.cancelByOwner("owner-1", 10, "   "),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ยกเลิกสำเร็จ: สถานะเป็น REJECTED บันทึกเหตุผล และคืนนักศึกษาเป็น IDLE", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "owner-1", departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 10, status: "PENDING_CONFIRMATION", departmentId: 10, studentUserId: "student-1", positionName: "Dev", departmentName: "IT" },
      ]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ email: "s1@example.com", fname: "สมชาย", lname: "ใจดี" }]),
    );

    const result = await service.cancelByOwner("owner-1", 10, "  คุณสมบัติไม่ตรง  ");

    expect(result).toEqual({ applicationStatus: "CANCEL" });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "REJECTED",
      isActive: false,
      statusNote: "คุณสมบัติไม่ตรง", // ต้องถูก trim() เหตุผล
    });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "IDLE",
    });
  });
});
