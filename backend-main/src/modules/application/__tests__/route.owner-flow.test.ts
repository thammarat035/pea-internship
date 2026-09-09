import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route "scope 2: flow ฝั่ง owner/admin ตั้งแต่สัมภาษณ์ผ่านจนถึงตรวจเอกสาร"
// ของ application module (approveInterview, confirmAccept, uploadRequestLetter,
// reviewDocument x4 docType, cancelByOwner) — ต่อจาก scope 1 (route.student-flow)
// ---------------------------------------------------------------------------

const mockApproveInterview = mock();
const mockConfirmAccept = mock();
const mockUploadRequestLetter = mock();
const mockReviewDocument = mock();
const mockCancelByOwner = mock();

mock.module("../service", () => ({
  ApplicationService: class {
    approveInterview = mockApproveInterview;
    confirmAccept = mockConfirmAccept;
    uploadRequestLetter = mockUploadRequestLetter;
    reviewDocument = mockReviewDocument;
    cancelByOwner = mockCancelByOwner;
  },
}));

const FAKE_USER = { id: "fake-owner-id", roleId: 2 };
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

function fakePdfFile(name: string) {
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n");
  return new File([pdfBytes], name, { type: "application/pdf" });
}

describe("application routes (owner flow)", () => {
  beforeEach(() => {
    mockApproveInterview.mockReset();
    mockConfirmAccept.mockReset();
    mockUploadRequestLetter.mockReset();
    mockReviewDocument.mockReset();
    mockCancelByOwner.mockReset();
  });

  describe("PUT /applications/:id/interview/approve", () => {
    it("เรียก service.approveInterview ด้วย session.userId และ id", async () => {
      mockApproveInterview.mockResolvedValue({ applicationStatus: "PENDING_CONFIRMATION" });

      const response = await application.handle(
        new Request("http://localhost/applications/10/interview/approve", {
          method: "PUT",
        }),
      );

      expect(response.status).toBe(200);
      expect(mockApproveInterview).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
      );
    });
  });

  describe("PUT /applications/:id/confirm/accept", () => {
    it("เรียก service.confirmAccept ด้วย session.userId และ id", async () => {
      mockConfirmAccept.mockResolvedValue({ applicationStatus: "PENDING_REQUEST" });

      const response = await application.handle(
        new Request("http://localhost/applications/10/confirm/accept", {
          method: "PUT",
        }),
      );

      expect(response.status).toBe(200);
      expect(mockConfirmAccept).toHaveBeenCalledWith(FAKE_SESSION.userId, 10);
    });
  });

  describe("POST /applications/:id/documents/request-letter", () => {
    it("เรียก service.uploadRequestLetter ด้วย session.userId, id และไฟล์", async () => {
      mockUploadRequestLetter.mockResolvedValue({ applicationStatus: "PENDING_REVIEW" });

      const formData = new FormData();
      formData.append("file", fakePdfFile("request-letter.pdf"));

      const response = await application.handle(
        new Request(
          "http://localhost/applications/10/documents/request-letter",
          { method: "POST", body: formData },
        ),
      );

      expect(response.status).toBe(200);
      expect(mockUploadRequestLetter).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        expect.any(File),
      );
    });
  });

  describe("PUT /applications/:id/documents/:docType/review", () => {
    it("แปลง docType='transcript' เป็น docTypeId=1 แล้วเรียก service.reviewDocument", async () => {
      mockReviewDocument.mockResolvedValue({ applicationStatus: "PENDING_REQUEST" });

      const response = await application.handle(
        new Request(
          "http://localhost/applications/10/documents/transcript/review",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "VERIFIED" }),
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(mockReviewDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        1,
        "VERIFIED",
        undefined,
        undefined,
      );
    });

    it("แปลง docType='request-letter' เป็น docTypeId=4 พร้อมส่ง note/invalidReasons ต่อ", async () => {
      mockReviewDocument.mockResolvedValue({ applicationStatus: "PENDING_REQUEST" });

      await application.handle(
        new Request(
          "http://localhost/applications/10/documents/request-letter/review",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "INVALID",
              note: "ไม่ชัดเจน",
              invalidReasons: ["ลายเซ็นไม่ครบ"],
            }),
          },
        ),
      );

      expect(mockReviewDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        4,
        "INVALID",
        "ไม่ชัดเจน",
        ["ลายเซ็นไม่ครบ"],
      );
    });

    it("ตอบ 422 เมื่อ docType ไม่อยู่ใน union ที่อนุญาต (validation)", async () => {
      const response = await application.handle(
        new Request(
          "http://localhost/applications/10/documents/unknown-type/review",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "VERIFIED" }),
          },
        ),
      );

      expect(response.status).not.toBe(200);
      expect(mockReviewDocument).not.toHaveBeenCalled();
    });
  });

  describe("PUT /applications/:id/interview/reject", () => {
    it("เรียก service.cancelByOwner ด้วย session.userId, id และเหตุผล", async () => {
      mockCancelByOwner.mockResolvedValue({ applicationStatus: "CANCEL" });

      const response = await application.handle(
        new Request("http://localhost/applications/10/interview/reject", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "คุณสมบัติไม่ตรง" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockCancelByOwner).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        "คุณสมบัติไม่ตรง",
      );
    });

    it("ตอบ 422 เมื่อไม่ส่ง reason มา (validation)", async () => {
      const response = await application.handle(
        new Request("http://localhost/applications/10/interview/reject", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).not.toBe(200);
      expect(mockCancelByOwner).not.toHaveBeenCalled();
    });
  });
});

afterAll(() => {
  mock.restore();
});
