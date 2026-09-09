import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 9 endpoint ของ check-time โดย mock CheckTimeService ทั้งคลาส
// (pattern เดียวกับ admin-dashboard) เพื่อโฟกัสแค่ "ชั้น HTTP" เท่านั้น:
//   - รับ query/body/params มาแปลงถูกไหม
//   - เรียก service method ที่ถูกต้องพร้อม argument ที่ถูกต้องไหม
//   - ตอบ status code ถูกไหม
//   - validation (t.Object schema) ทำงานจริงไหม
//
// route นี้มีทั้ง endpoint ที่ใช้ macro "role: [...]" และ "auth: true"
// (คนละแบบกัน) จึงต้อง mock ทั้งสอง macro ให้ isAuthenticated ปลอม
// ---------------------------------------------------------------------------

const mockIn = mock();
const mockOut = mock();
const mockHistory = mock();
const mockEdit = mock();
const mockGetCorrectionDetail = mock();
const mockGetFile = mock();
const mockGetMentorCorrections = mock();
const mockGetMentorCorrectionAuditView = mock();
const mockApproveCorrection = mock();
const mockRejectCorrection = mock();

mock.module("../service", () => ({
  CheckTimeService: class {
    in = mockIn;
    out = mockOut;
    history = mockHistory;
    edit = mockEdit;
    getCorrectionDetail = mockGetCorrectionDetail;
    getFile = mockGetFile;
    getMentorCorrections = mockGetMentorCorrections;
    getMentorCorrectionAuditView = mockGetMentorCorrectionAuditView;
    approveCorrection = mockApproveCorrection;
    rejectCorrection = mockRejectCorrection;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };

mock.module("@/middlewares/auth.middleware", () => ({
  ROLE_IDS: { ADMIN: 1, MENTOR: 2, STUDENT: 3 },
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({
        user: FAKE_USER,
        session: { id: "fake-session" },
      }),
    },
    role: () => ({
      resolve: () => ({
        user: FAKE_USER,
        session: { id: "fake-session" },
      }),
    }),
  }),
}));

const { checkTime } = await import("../index");

describe("checkTime routes", () => {
  beforeEach(() => {
    mockIn.mockReset();
    mockOut.mockReset();
    mockHistory.mockReset();
    mockEdit.mockReset();
    mockGetCorrectionDetail.mockReset();
    mockGetFile.mockReset();
    mockGetMentorCorrections.mockReset();
    mockGetMentorCorrectionAuditView.mockReset();
    mockApproveCorrection.mockReset();
    mockRejectCorrection.mockReset();
  });

  describe("POST /check-time/in", () => {
    it("เรียก service.in ด้วย userId และ body ที่ส่งมา คืน status 201", async () => {
      mockIn.mockResolvedValue({ success: true, status: "PRESENT" });

      const response = await checkTime.handle(
        new Request("http://localhost/check-time/in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: 13.75, longitude: 100.5 }),
        }),
      );

      expect(response.status).toBe(201);
      expect(mockIn).toHaveBeenCalledWith(
        FAKE_USER.id,
        "unknown", // ไม่มี header x-forwarded-for ส่งมา จึงได้ "unknown"
        expect.objectContaining({ latitude: 13.75, longitude: 100.5 }),
      );
    });

    it("อ่าน IP จาก header x-forwarded-for เมื่อมีการส่งมา", async () => {
      mockIn.mockResolvedValue({ success: true, status: "PRESENT" });

      await checkTime.handle(
        new Request("http://localhost/check-time/in", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.5",
          },
          body: JSON.stringify({}),
        }),
      );

      expect(mockIn).toHaveBeenCalledWith(
        FAKE_USER.id,
        "203.0.113.5",
        expect.anything(),
      );
    });
  });

  describe("POST /check-time/out", () => {
    it("เรียก service.out ด้วย userId และ body ที่ส่งมา คืน status 201", async () => {
      mockOut.mockResolvedValue({ success: true, hoursWorked: "7.00" });

      const response = await checkTime.handle(
        new Request("http://localhost/check-time/out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: 13.75, longitude: 100.5 }),
        }),
      );

      expect(response.status).toBe(201);
      expect(mockOut).toHaveBeenCalledWith(
        FAKE_USER.id,
        "unknown",
        expect.anything(),
      );
    });
  });

  describe("GET /check-time/history", () => {
    it("แปลง query param จาก string เป็นตัวเลขก่อนส่งเข้า service.history", async () => {
      mockHistory.mockResolvedValue({ records: [] });

      await checkTime.handle(
        new Request(
          "http://localhost/check-time/history?year=2025&month=3&page=2&limit=20&filterStatus=LATE",
        ),
      );

      expect(mockHistory).toHaveBeenCalledWith(
        FAKE_USER.id,
        2025,
        3,
        2,
        20,
        "LATE",
      );
    });

    it("ใช้ page=1 และ limit=10 เป็นค่า default เมื่อไม่ได้ส่ง query มา", async () => {
      mockHistory.mockResolvedValue({ records: [] });

      await checkTime.handle(
        new Request("http://localhost/check-time/history"),
      );

      expect(mockHistory).toHaveBeenCalledWith(
        FAKE_USER.id,
        undefined,
        undefined,
        1,
        10,
        undefined,
      );
    });
  });

  describe("PUT /check-time/edit", () => {
    it("เรียก service.edit ด้วย userId และ body คืน status 200", async () => {
      mockEdit.mockResolvedValue({ success: true, requestId: 1 });

      const formData = new FormData();
      formData.append("attendanceLogId", "10");
      formData.append("checkInTime", "08:30");
      formData.append("checkOutTime", "16:30");
      formData.append("reason", "ลืมลงเวลา");

      const response = await checkTime.handle(
        new Request("http://localhost/check-time/edit", {
          method: "PUT",
          body: formData,
        }),
      );

      expect(response.status).toBe(200);
      expect(mockEdit).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ reason: "ลืมลงเวลา" }),
      );
    });
  });

  describe("GET /check-time/edit/:id", () => {
    it("เรียก service.getCorrectionDetail ด้วย userId และ id จาก params", async () => {
      mockGetCorrectionDetail.mockResolvedValue({ success: true, data: {} });

      const response = await checkTime.handle(
        new Request("http://localhost/check-time/edit/42"),
      );

      expect(response.status).toBe(200);
      expect(mockGetCorrectionDetail).toHaveBeenCalledWith(FAKE_USER.id, 42);
    });
  });

  describe("GET /check-time/file", () => {
    it("เรียก service.getFile ด้วย key จาก query string", async () => {
      mockGetFile.mockResolvedValue({
        buffer: new Uint8Array([1, 2, 3]),
        contentType: "application/pdf",
      });

      const response = await checkTime.handle(
        new Request(
          "http://localhost/check-time/file?key=time-corrections/abc.pdf",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetFile).toHaveBeenCalledWith("time-corrections/abc.pdf");
    });
  });

  describe("GET /check-time/mentor/corrections", () => {
    it("เรียก service.getMentorCorrections ด้วย mentorUserId และ query", async () => {
      mockGetMentorCorrections.mockResolvedValue({ data: [], meta: {} });

      const response = await checkTime.handle(
        new Request(
          "http://localhost/check-time/mentor/corrections?status=PENDING",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetMentorCorrections).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ status: "PENDING" }),
      );
    });
  });

  describe("GET /check-time/mentor/corrections/:id/audit", () => {
    it("เรียก service.getMentorCorrectionAuditView ด้วย mentorUserId และ id", async () => {
      mockGetMentorCorrectionAuditView.mockResolvedValue({
        success: true,
        data: {},
      });

      const response = await checkTime.handle(
        new Request("http://localhost/check-time/mentor/corrections/7/audit"),
      );

      expect(response.status).toBe(200);
      expect(mockGetMentorCorrectionAuditView).toHaveBeenCalledWith(
        FAKE_USER.id,
        7,
      );
    });
  });

  describe("POST /check-time/mentor/corrections/:id/approve", () => {
    it("เรียก service.approveCorrection ด้วย mentorUserId และ id", async () => {
      mockApproveCorrection.mockResolvedValue({
        success: true,
        newStatus: "PRESENT",
      });

      const response = await checkTime.handle(
        new Request(
          "http://localhost/check-time/mentor/corrections/5/approve",
          { method: "POST" },
        ),
      );

      expect(response.status).toBe(200);
      expect(mockApproveCorrection).toHaveBeenCalledWith(FAKE_USER.id, 5);
    });
  });

  describe("POST /check-time/mentor/corrections/:id/reject", () => {
    it("เรียก service.rejectCorrection ด้วย mentorUserId, id และเหตุผล", async () => {
      mockRejectCorrection.mockResolvedValue({ success: true });

      const response = await checkTime.handle(
        new Request(
          "http://localhost/check-time/mentor/corrections/5/reject",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "ข้อมูลไม่ถูกต้อง" }),
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(mockRejectCorrection).toHaveBeenCalledWith(
        FAKE_USER.id,
        5,
        "ข้อมูลไม่ถูกต้อง",
      );
    });

    it("ตอบ 422 เมื่อไม่ส่ง reason มาเลย (validation)", async () => {
      const response = await checkTime.handle(
        new Request(
          "http://localhost/check-time/mentor/corrections/5/reject",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        ),
      );

      expect(response.status).not.toBe(200);
      expect(mockRejectCorrection).not.toHaveBeenCalled();
    });
  });
});

afterAll(() => {
  mock.restore();
});