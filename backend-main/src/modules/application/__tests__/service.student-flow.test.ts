import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส scope 1 ของ ApplicationService: flow ฝั่งนักศึกษาก่อนสัมภาษณ์
// (apply, submitInformation, updateApplicationInformation,
// uploadRequiredDocument, cancelByStudent) — โมดูลนี้ต่างจากโมดูลก่อนหน้าตรงที่
// "ไม่มี db.query.*" เลย ใช้แต่ tx.select().from().where() ล้วนๆ (บาง method
// มีมากถึง 5-6 select ต่อเนื่องกันใน 1 transaction) mock harness นี้จึงมีแค่
// mockSelect/mockInsert/mockUpdate ไม่มี queryMocks แบบโมดูลอื่น
//
// สำคัญ: ต้องนับลำดับ tx.select() ในโค้ดจริงให้ครบก่อน queue ค่า mock
// (เหมือนที่เจอใน mentor/service.db.test.ts) ไม่งั้นค่าจะเลื่อนคิวผิดตัว
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertOnConflict = mock(() => Promise.resolve());
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
  onConflictDoUpdate: mockInsertOnConflict,
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

const mockS3Send = mock();
mock.module("@/lib/s3", () => ({
  s3Client: { send: mockS3Send },
  BUCKET_NAME: "test-bucket",
}));

// ApplicationService สร้าง instance ของ MailService/StaffLogsService ที่ module-level
// ตอน import ("const mailService = new MailService()") ซึ่งจะไปเรียก process.env
// จริงถ้าไม่ mock (ไม่ได้ใช้ในทุก test ของ scope นี้ แต่ต้อง mock กันพังตอน import)
mock.module("@/modules/mail/service", () => ({
  MailService: class {
    sendEmail = mock(() => Promise.resolve());
    buildPositionFilledEmail = mock(() => ({ subject: "", html: "" }));
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
  mockInsertOnConflict.mockClear();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockS3Send.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationService.apply", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws BadRequestError เมื่อสถานะฝึกงานปัจจุบันไม่อนุญาตให้สมัครกองใหม่", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ internshipStatus: "PENDING" }]),
    );

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("throws NotFoundError เมื่อไม่พบตำแหน่งฝึกงาน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อตำแหน่งไม่ได้เปิดรับสมัคร (recruitmentStatus != OPEN)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, recruitmentStatus: "CLOSED", positionCount: 5, acceptedCount: 0 }]),
    );

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("throws BadRequestError เมื่อตำแหน่งมีผู้ได้รับคัดเลือกครบจำนวนแล้ว", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 1, recruitmentStatus: "OPEN", positionCount: 2, acceptedCount: 2 },
      ]),
    );

    expect(service.apply("user-1", 1)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("สมัครสำเร็จ คืนข้อมูลตำแหน่งพร้อม nextStep=SUBMIT_INFORMATION เมื่อทุกเงื่อนไขผ่าน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "COMPLETE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          id: 1,
          departmentId: 10,
          recruitmentStatus: "OPEN",
          resumeRq: true,
          portfolioRq: false,
          positionCount: 5,
          acceptedCount: 1,
        },
      ]),
    );

    const result = await service.apply("user-1", 1);

    expect(result).toEqual({
      positionId: 1,
      departmentId: 10,
      resumeRq: true,
      portfolioRq: false,
      nextStep: "SUBMIT_INFORMATION",
    });
  });
});

describe("ApplicationService.submitInformation", () => {
  const validData = {
    skill: "React",
    expectation: "อยากเรียนรู้งานจริง",
    startDate: new Date("2025-06-01"),
    endDate: new Date("2025-08-01"),
    hours: 560,
  };

  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.submitInformation("user-1", 1, validData),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อ endDate ก่อน startDate", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, departmentId: 10, recruitmentStatus: "OPEN" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.submitInformation("user-1", 1, {
        ...validData,
        startDate: new Date("2025-08-01"),
        endDate: new Date("2025-06-01"),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อไม่ระบุ hours", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, departmentId: 10, recruitmentStatus: "OPEN" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.submitInformation("user-1", 1, {
        ...validData,
        hours: undefined as unknown as number,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("สร้างใบสมัครรอบแรกสำเร็จ (ไม่มีรอบเก่า -> internshipRound=1) และอัปเดตสถานะนักศึกษาเป็น PENDING", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, departmentId: 10, recruitmentStatus: "OPEN" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // ยังไม่เคยสมัครมาก่อน
    mockInsertReturning.mockResolvedValueOnce([
      { id: 100, applicationStatus: "PENDING_DOCUMENT" },
    ]);

    const result = await service.submitInformation(
      "user-1",
      1,
      validData,
    );

    expect(result).toEqual({
      applicationId: 100,
      applicationStatus: "PENDING_DOCUMENT",
    });
    // insert ครั้งที่ 1 = applicationStatuses, ครั้งที่ 2 = applicationStatusActions (log),
    // ครั้งที่ 3 = applicationInformations
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      internshipRound: 1,
      applicationStatus: "PENDING_DOCUMENT",
    });
    expect(mockInsertValues.mock.calls[2][0]).toMatchObject({
      applicationStatusId: 100,
      skill: "React",
      hours: "560",
    });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      internshipStatus: "PENDING",
    });
  });

  it("ต่อรอบใหม่ถูกต้องเมื่อเคยสมัครมาก่อน (internshipRound = รอบล่าสุด + 1)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "COMPLETE" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, departmentId: 10, recruitmentStatus: "OPEN" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ round: 2 }]));
    mockInsertReturning.mockResolvedValueOnce([
      { id: 101, applicationStatus: "PENDING_DOCUMENT" },
    ]);

    await service.submitInformation("user-1", 1, validData);

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      internshipRound: 3,
    });
  });
});

describe("ApplicationService.updateApplicationInformation", () => {
  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.updateApplicationInformation("user-1", 10, {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อใบสมัครไม่ใช่ของผู้ใช้ที่ร้องขอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "someone-else" }]),
    );

    expect(
      service.updateApplicationInformation("user-1", 10, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อ endDate ใหม่ก่อน startDate เดิมที่ยังไม่ได้แก้", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "user-1" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          startDate: new Date("2025-06-01"),
          endDate: new Date("2025-08-01"),
          hours: "560",
        },
      ]),
    );

    expect(
      service.updateApplicationInformation("user-1", 10, {
        endDate: "2025-05-01", // ก่อน startDate เดิม
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อ hours ติดลบ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "user-1" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" },
      ]),
    );

    expect(
      service.updateApplicationInformation("user-1", 10, { hours: -5 }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("อัปเดตเฉพาะ hours สำเร็จ โดยไม่แตะ startDate/endDate เดิม", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "user-1" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" },
      ]),
    );
    mockUpdateReturning.mockResolvedValueOnce([
      { id: 5, startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "500", updatedAt: new Date() },
    ]);

    const result = await service.updateApplicationInformation("user-1", 10, {
      hours: 500,
    });

    expect(result.success).toBe(true);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ hours: "500" });
    expect(mockUpdateSet.mock.calls[0][0]).not.toHaveProperty("startDate");
  });

  it("ล้างค่า hours เป็น null ได้เมื่อส่ง hours:null มา", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, userId: "user-1" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" },
      ]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    await service.updateApplicationInformation("user-1", 10, { hours: null });

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ hours: null });
  });
});

describe("ApplicationService.uploadRequiredDocument", () => {
  const baseApp = {
    id: 10,
    ownerUserId: "user-1",
    status: "PENDING_DOCUMENT",
    positionId: 1,
    departmentId: 10,
    positionName: "Developer",
  };

  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.uploadRequiredDocument(
        "user-1",
        10,
        1,
        new File(["x"], "a.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อไม่ใช่เจ้าของใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ ...baseApp, ownerUserId: "someone-else" }]),
    );

    expect(
      service.uploadRequiredDocument(
        "user-1",
        10,
        1,
        new File(["x"], "a.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อสถานะใบสมัครไม่อยู่ในขั้นตอนรอยื่นเอกสาร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ ...baseApp, status: "PENDING_INTERVIEW" }]),
    );

    expect(
      service.uploadRequiredDocument(
        "user-1",
        10,
        1,
        new File(["x"], "a.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่ออัปโหลด resume แต่ตำแหน่งไม่ได้ require resume", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ resumeRq: false, portfolioRq: false }]),
    );

    expect(
      service.uploadRequiredDocument(
        "user-1",
        10,
        2,
        new File(["x"], "resume.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("อัปโหลดเอกสารสำเร็จแต่ยังไม่ครบ -> สถานะยังเป็น PENDING_DOCUMENT ไม่แจ้งเตือน owner", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ resumeRq: true, portfolioRq: false }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }]));
    mockS3Send.mockResolvedValueOnce({});
    // ยื่นแค่ transcript อย่างเดียว (ยังขาด resume ที่ require)
    mockSelect.mockReturnValueOnce(makeChainable([{ docTypeId: 1 }]));

    const result = await service.uploadRequiredDocument(
      "user-1",
      10,
      1,
      new File(["x"], "transcript.pdf", { type: "application/pdf" }),
    );

    expect(result.applicationStatus).toBe("PENDING_DOCUMENT");
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    // insert ครั้งเดียว (applicationDocuments) ไม่มี insert notifications เพิ่ม
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("อัปโหลดเอกสารครบ (transcript+resume) -> เปลี่ยนเป็น PENDING_INTERVIEW และแจ้งเตือน owner ในแผนก", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([baseApp]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ resumeRq: true, portfolioRq: false }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }]));
    mockS3Send.mockResolvedValueOnce({});
    // อัปโหลด resume เป็นตัวสุดท้าย ตอนนี้มีครบทั้ง transcript(1) กับ resume(2) แล้ว
    mockSelect.mockReturnValueOnce(
      makeChainable([{ docTypeId: 1 }, { docTypeId: 2 }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "owner-1" }, { id: "owner-2" }]),
    ); // owners ในแผนก

    const result = await service.uploadRequiredDocument(
      "user-1",
      10,
      2,
      new File(["x"], "resume.pdf", { type: "application/pdf" }),
    );

    expect(result.applicationStatus).toBe("PENDING_INTERVIEW");
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "PENDING_INTERVIEW",
    });
    // insert 1: applicationDocuments, insert 2: applicationStatusActions (log),
    // insert 3: notifications (2 owners)
    expect(mockInsertValues).toHaveBeenCalledTimes(3);
    const notificationPayload = mockInsertValues.mock.calls[2][0] as unknown[];
    expect(notificationPayload).toHaveLength(2);
  });

  it("อัปโหลดเอกสาร request-letter เพิ่มเติมตอนสถานะ PENDING_REQUEST -> validationStatus เป็น PENDING เพื่อรอตรวจ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ ...baseApp, status: "PENDING_REQUEST" }]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ resumeRq: true, portfolioRq: false }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }]));
    mockS3Send.mockResolvedValueOnce({});

    const result = await service.uploadRequiredDocument(
      "user-1",
      10,
      1,
      new File(["x"], "transcript-updated.pdf", { type: "application/pdf" }),
    );

    expect(result.validationStatus).toBe("PENDING");
    expect(result.applicationStatus).toBe("PENDING_REQUEST");
  });
});

describe("ApplicationService.cancelByStudent", () => {
  it("throws NotFoundError เมื่อไม่พบใบสมัคร", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.cancelByStudent("user-1", 10),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อใบสมัครไม่ใช่ของผู้ใช้ที่ร้องขอ", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "someone-else", status: "PENDING_DOCUMENT" }]),
    );

    expect(
      service.cancelByStudent("user-1", 10),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อสถานะไม่ใช่ PENDING_DOCUMENT อีกแล้ว", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_INTERVIEW" }]),
    );

    expect(
      service.cancelByStudent("user-1", 10),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อมีการส่งเอกสารไปแล้ว (ยกเลิกไม่ได้)", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_DOCUMENT" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }])); // มีเอกสารแล้ว

    expect(
      service.cancelByStudent("user-1", 10),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ยกเลิกสำเร็จ: อัปเดตสถานะเป็น ABORT และคืนสถานะนักศึกษาเป็น IDLE", async () => {
    const service = new ApplicationService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, ownerUserId: "user-1", status: "PENDING_DOCUMENT" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // ยังไม่มีเอกสาร

    const result = await service.cancelByStudent("user-1", 10);

    expect(result).toEqual({ applicationStatus: "ABORT" });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      applicationStatus: "ABORT",
      isActive: false,
    });
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
      internshipStatus: "IDLE",
    });
  });
});
