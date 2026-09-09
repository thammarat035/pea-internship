import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route เฉพาะ "scope 1: flow ฝั่งนักศึกษาก่อนสัมภาษณ์" ของ application module
// (apply / submitInformation / updateApplicationInformation /
// uploadRequiredDocument x3 / cancelByStudent) — module นี้ใหญ่มาก (19 เมธอด)
// จึงแบ่งเทสเป็นหลายไฟล์ตาม scope แทนที่จะทำทีเดียวหมด ส่วนที่เหลือ
// (approveInterview, confirmAccept, reviewDocument, history, cancelByOwner ฯลฯ)
// จะเทสในไฟล์ scope ถัดๆ ไป
//
// จุดต่างจากโมดูลอื่น: route นี้ใช้ session.userId (ไม่ใช่ user.id) เป็น
// identity หลัก จึง mock ให้ session ปลอมมี userId ด้วย
// ---------------------------------------------------------------------------

const mockApply = mock();
const mockSubmitInformation = mock();
const mockUpdateApplicationInformation = mock();
const mockUploadRequiredDocument = mock();
const mockCancelByStudent = mock();

mock.module("../service", () => ({
  ApplicationService: class {
    apply = mockApply;
    submitInformation = mockSubmitInformation;
    updateApplicationInformation = mockUpdateApplicationInformation;
    uploadRequiredDocument = mockUploadRequiredDocument;
    cancelByStudent = mockCancelByStudent;
  },
}));

const FAKE_USER = { id: "fake-student-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
    role: () => ({
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    }),
  }),
}));

const { application } = await import("../index");

// elysia ใช้ package "file-type" sniff magic bytes จริงของไฟล์ (ไม่ใช่แค่เชื่อ
// `.type` ที่ประกาศมา) ตอนตรวจ t.File({ type: [...] }) จึงต้องสร้างไฟล์ที่มี
// header ของ PDF จริงๆ ไม่งั้น validation จะตีเป็น 422 "Invalid file type" เสมอ
function fakePdfFile(name: string) {
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n");
  return new File([pdfBytes], name, { type: "application/pdf" });
}

describe("application routes (student flow)", () => {
  beforeEach(() => {
    mockApply.mockReset();
    mockSubmitInformation.mockReset();
    mockUpdateApplicationInformation.mockReset();
    mockUploadRequiredDocument.mockReset();
    mockCancelByStudent.mockReset();
  });

  describe("POST /applications/", () => {
    it("เรียก service.apply ด้วย session.userId และ positionId คืน status 200", async () => {
      mockApply.mockResolvedValue({ positionId: 1, nextStep: "SUBMIT_INFORMATION" });

      const response = await application.handle(
        new Request("http://localhost/applications/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionId: 1 }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockApply).toHaveBeenCalledWith(FAKE_SESSION.userId, 1);
    });
  });

  describe("POST /applications/positions/:positionId/information", () => {
    it("เรียก service.submitInformation ด้วย positionId จาก params และ body คืน status 201", async () => {
      mockSubmitInformation.mockResolvedValue({ applicationId: 10 });

      const response = await application.handle(
        new Request(
          "http://localhost/applications/positions/5/information",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              skill: "React",
              expectation: "อยากเรียนรู้งานจริง",
              startDate: "2025-06-01T00:00:00.000Z",
              endDate: "2025-08-01T00:00:00.000Z",
              hours: 560,
            }),
          },
        ),
      );

      expect(response.status).toBe(201);
      expect(mockSubmitInformation).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        5,
        expect.objectContaining({ skill: "React", hours: 560 }),
      );
    });
  });

  describe("PUT /applications/:id/information", () => {
    it("เรียก service.updateApplicationInformation ด้วย id จาก params และ body คืน status 200", async () => {
      mockUpdateApplicationInformation.mockResolvedValue({ success: true });

      const response = await application.handle(
        new Request("http://localhost/applications/10/information", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: 500 }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockUpdateApplicationInformation).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        expect.objectContaining({ hours: 500 }),
      );
    });
  });

  describe("POST /applications/:id/documents/:docType", () => {
    it("อัปโหลด transcript เรียก service.uploadRequiredDocument ด้วย docTypeId=1", async () => {
      mockUploadRequiredDocument.mockResolvedValue({ docTypeId: 1 });

      const formData = new FormData();
      formData.append("file", fakePdfFile("transcript.pdf"));

      const response = await application.handle(
        new Request("http://localhost/applications/10/documents/transcript", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).toBe(200);
      expect(mockUploadRequiredDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        1,
        expect.any(File),
      );
    });

    it("อัปโหลด resume เรียก service.uploadRequiredDocument ด้วย docTypeId=2", async () => {
      mockUploadRequiredDocument.mockResolvedValue({ docTypeId: 2 });

      const formData = new FormData();
      formData.append("file", fakePdfFile("resume.pdf"));

      await application.handle(
        new Request("http://localhost/applications/10/documents/resume", {
          method: "POST",
          body: formData,
        }),
      );

      expect(mockUploadRequiredDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        2,
        expect.any(File),
      );
    });

    it("อัปโหลด portfolio เรียก service.uploadRequiredDocument ด้วย docTypeId=3", async () => {
      mockUploadRequiredDocument.mockResolvedValue({ docTypeId: 3 });

      const formData = new FormData();
      formData.append("file", fakePdfFile("portfolio.pdf"));

      await application.handle(
        new Request("http://localhost/applications/10/documents/portfolio", {
          method: "POST",
          body: formData,
        }),
      );

      expect(mockUploadRequiredDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        3,
        expect.any(File),
      );
    });

    it("ตอบ 422 เมื่อไฟล์เป็นประเภทที่ไม่อนุญาต (validation)", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["dummy"], "malware.exe", {
          type: "application/x-msdownload",
        }),
      );

      const response = await application.handle(
        new Request("http://localhost/applications/10/documents/transcript", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).not.toBe(200);
      expect(mockUploadRequiredDocument).not.toHaveBeenCalled();
    });
  });

  describe("PUT /applications/:id/cancel", () => {
    it("เรียก service.cancelByStudent ด้วย session.userId และ id คืน status 200", async () => {
      mockCancelByStudent.mockResolvedValue({ applicationStatus: "ABORT" });

      const response = await application.handle(
        new Request("http://localhost/applications/10/cancel", {
          method: "PUT",
        }),
      );

      expect(response.status).toBe(200);
      expect(mockCancelByStudent).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
      );
    });
  });
});

afterAll(() => {
  mock.restore();
});
