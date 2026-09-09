import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส ApplicationDocumentsService ทั้ง 2 เมธอด (findAllDocuments, streamDocument)
// โมดูลนี้ต่างจากที่ผ่านมาตรงที่ฟังก์ชัน helper ล้วนๆ (docTypeName, docTypeLabel,
// parseApplicationIdFromKey, normalizeName, formatDateYYYYMMDD, toAsciiFilename,
// contentDispositionInline ฯลฯ) เป็น local function ที่ "ไม่ได้ export" จากไฟล์
// จึงเทสตรงๆ แบบ (service as any) ไม่ได้เหมือนโมดูลอื่น ต้องเทส "ผ่าน" ผลลัพธ์
// ของ streamDocument (filename/contentDisposition ที่คำนวณจาก helper พวกนี้รวมกัน)
// แทน — สำคัญมากที่ streamDocument ต้องมีเคสหลากหลายพอจะครอบ helper ทุกตัว
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

const dbMock = { select: mockSelect };
mock.module("@/db", () => ({ db: dbMock }));

const mockS3Send = mock();
mock.module("@/lib/s3", () => ({
  s3Client: { send: mockS3Send },
  BUCKET_NAME: "test-bucket",
}));

const { ApplicationDocumentsService } = await import("../service");
const { ForbiddenError } = await import("@/common/exceptions");

beforeEach(() => {
  mockSelect.mockReset();
  mockS3Send.mockReset();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationDocumentsService.findAllDocuments", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.findAllDocuments("user-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานไม่ใช่ Admin (roleId != 1)", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 2 }]));

    expect(
      service.findAllDocuments("user-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("แปลง docTypeId เป็นชื่อ docType และดึง filename จาก path ของ docFile", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { id: 1, docTypeId: 1, docFile: "applications/10/1/transcript.pdf", invalidReasons: null },
        { id: 2, docTypeId: 2, docFile: "applications/10/2/resume.pdf", invalidReasons: ["ไฟล์เบลอ"] },
        { id: 3, docTypeId: 4, docFile: "applications/10/4/letter.pdf", invalidReasons: null },
      ]),
    );

    const result = await service.findAllDocuments("admin-1", {});

    expect(result[0]).toMatchObject({ docType: "transcript", filename: "transcript.pdf" });
    expect(result[1]).toMatchObject({ docType: "resume", filename: "resume.pdf", invalidReasons: ["ไฟล์เบลอ"] });
    expect(result[2]).toMatchObject({ docType: "request-letter", filename: "letter.pdf" });
  });

  it("รับ query filter ครบทุกตัว (applicationStatusId/docTypeId/validationStatus/departmentId/userId/q) โดยไม่ error และใช้ 'unknown' เมื่อ docTypeId ไม่รู้จัก", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, docTypeId: 99, docFile: "a.pdf", invalidReasons: null }]),
    );

    const result = await service.findAllDocuments("admin-1", {
      applicationStatusId: 10,
      docTypeId: 1,
      validationStatus: "PENDING",
      departmentId: 5,
      userId: "student-1",
      q: "สมชาย",
    });

    expect(result[0].docType).toBe("unknown");
  });

  it("ใช้ 'file' เป็นชื่อ fallback เมื่อ docFile เป็น null", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, docTypeId: 1, docFile: null, invalidReasons: null }]),
    );

    const result = await service.findAllDocuments("admin-1", {});

    expect(result[0].filename).toBe("file");
  });
});

describe("ApplicationDocumentsService.streamDocument", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.streamDocument("user-1", "applications/10/1/a.pdf"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อ key ไม่ตรง pattern (path สั้นเกินไป / ไม่ขึ้นต้นด้วย applications / applicationId ไม่ใช่ตัวเลข)", async () => {
    const service = new ApplicationDocumentsService();
    const badKeys = [
      "applications/10", // ส่วนไม่ครบ 4 ท่อน
      "other/10/1/a.pdf", // ไม่ขึ้นต้นด้วย applications
      "applications/abc/1/a.pdf", // applicationId ไม่ใช่ตัวเลข
    ];

    for (const key of badKeys) {
      mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1, departmentId: null }]));
      await expect(
        service.streamDocument("user-1", key),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("throws ForbiddenError เมื่อไม่พบใบสมัครที่ key อ้างถึง", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1, departmentId: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.streamDocument("user-1", "applications/10/1/a.pdf"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อ Owner คนละแผนกพยายามเข้าถึงเอกสาร", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 2, departmentId: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "student-1", departmentId: 99 }]));

    expect(
      service.streamDocument("owner-1", "applications/10/1/a.pdf"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อนักศึกษาพยายามเข้าถึงเอกสารของคนอื่น", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 3, departmentId: null }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "someone-else", departmentId: 10 }]));

    expect(
      service.streamDocument("student-1", "applications/10/1/a.pdf"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Admin เข้าถึงเอกสารได้เสมอไม่ว่าแผนกไหน และตั้งชื่อไฟล์จากชื่อนักศึกษา+ประเภทเอกสาร+วันที่แก้ไขล่าสุด", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 1, departmentId: null }])); // me
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "student-1", departmentId: 10 }])); // app
    mockSelect.mockReturnValueOnce(
      makeChainable([{ docTypeId: 1, createdAt: new Date("2025-06-01"), updatedAt: new Date("2025-06-15") }]),
    ); // docRow
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }])); // student
    mockS3Send.mockResolvedValueOnce({
      Body: "stream" as unknown,
      ContentType: "application/pdf",
    });

    const result = await service.streamDocument(
      "admin-1",
      "applications/10/1/transcript.pdf",
    );

    expect(result.filename).toBe("สมชาย_ใจดี_TRANSCRIPT_20250615.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.contentDisposition).toContain('filename="');
    expect(result.contentDisposition).toContain("filename*=UTF-8''");
  });

  it("Owner แผนกเดียวกันเข้าถึงได้ และใช้เวลาปัจจุบันเป็นวันที่เมื่อไม่พบแถวเอกสาร (docRow undefined)", async () => {
    const service = new ApplicationDocumentsService();
    setSystemTime(new Date("2025-03-10T12:00:00Z"));
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 2, departmentId: 10 }])); // me
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "student-1", departmentId: 10 }])); // app
    mockSelect.mockReturnValueOnce(makeChainable([])); // docRow ไม่พบ
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: "สมชาย", lname: "ใจดี" }])); // student
    mockS3Send.mockResolvedValueOnce({ Body: "stream" as unknown, ContentType: undefined });

    const result = await service.streamDocument(
      "owner-1",
      "applications/10/2/resume.pdf",
    );

    // docTypeId มาจาก key (2=resume) เพราะ docRow ไม่พบ, วันที่ fallback เป็นวันนี้ (frozen)
    expect(result.filename).toBe("สมชาย_ใจดี_RESUME_20250310.pdf");
    expect(result.contentType).toBe("application/octet-stream"); // fallback เมื่อ ContentType ว่าง
  });

  it("นักศึกษาเจ้าของเอกสารเข้าถึงได้ และใช้ 'student_unknown' เป็น fallback เมื่อไม่มีชื่อ พร้อม ext เป็น 'bin' เมื่อไม่มีนามสกุลไฟล์", async () => {
    const service = new ApplicationDocumentsService();
    mockSelect.mockReturnValueOnce(makeChainable([{ roleId: 3, departmentId: null }])); // me
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "student-1", departmentId: 10 }])); // app
    mockSelect.mockReturnValueOnce(
      makeChainable([{ docTypeId: 99, createdAt: new Date("2025-01-01"), updatedAt: null }]),
    ); // docRow มี docTypeId แปลกที่ไม่รู้จัก
    mockSelect.mockReturnValueOnce(makeChainable([{ fname: null, lname: null }])); // ไม่มีชื่อ
    mockS3Send.mockResolvedValueOnce({ Body: "stream" as unknown, ContentType: "application/pdf" });

    const result = await service.streamDocument(
      "student-1",
      "applications/10/1/noext",
    );

    expect(result.filename).toBe("student_unknown_DOCUMENT_20250101.bin");
  });
});
