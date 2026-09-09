import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 12 endpoint ของ leave-requests โดย mock LeaveService ทั้งคลาส
// (pattern เดียวกับ check-time/route.test.ts) เพื่อโฟกัสแค่ "ชั้น HTTP" เท่านั้น:
//   - รับ body/query/params มาแปลง/ส่งต่อให้ service ถูก argument ไหม
//   - ตอบ status code ถูกไหม
//   - validation (t.Object schema) ทำงานจริงไหม (เช่น ต้องมี reason ตอน reject)
// ---------------------------------------------------------------------------

const mockSubmitLeaveRequest = mock();
const mockResubmitLeaveRequests = mock();
const mockGetLeaveHistory = mock();
const mockDeleteLeaveRequest = mock();
const mockBulkDeleteLeaveRequests = mock();
const mockApproveLeaveRequest = mock();
const mockBulkApproveLeaveRequests = mock();
const mockRejectLeaveRequest = mock();
const mockBulkRejectLeaveRequests = mock();
const mockGetMentorLeaveRequests = mock();
const mockGetMentorAuditList = mock();
const mockGetMentorAuditView = mock();

mock.module("../service", () => ({
  LeaveService: class {
    submitLeaveRequest = mockSubmitLeaveRequest;
    resubmitLeaveRequests = mockResubmitLeaveRequests;
    getLeaveHistory = mockGetLeaveHistory;
    deleteLeaveRequest = mockDeleteLeaveRequest;
    bulkDeleteLeaveRequests = mockBulkDeleteLeaveRequests;
    approveLeaveRequest = mockApproveLeaveRequest;
    bulkApproveLeaveRequests = mockBulkApproveLeaveRequests;
    rejectLeaveRequest = mockRejectLeaveRequest;
    bulkRejectLeaveRequests = mockBulkRejectLeaveRequests;
    getMentorLeaveRequests = mockGetMentorLeaveRequests;
    getMentorAuditList = mockGetMentorAuditList;
    getMentorAuditView = mockGetMentorAuditView;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };

mock.module("@/middlewares/auth.middleware", () => ({
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

const { leave } = await import("../index");

describe("leave routes", () => {
  beforeEach(() => {
    mockSubmitLeaveRequest.mockReset();
    mockResubmitLeaveRequests.mockReset();
    mockGetLeaveHistory.mockReset();
    mockDeleteLeaveRequest.mockReset();
    mockBulkDeleteLeaveRequests.mockReset();
    mockApproveLeaveRequest.mockReset();
    mockBulkApproveLeaveRequests.mockReset();
    mockRejectLeaveRequest.mockReset();
    mockBulkRejectLeaveRequests.mockReset();
    mockGetMentorLeaveRequests.mockReset();
    mockGetMentorAuditList.mockReset();
    mockGetMentorAuditView.mockReset();
  });

  describe("POST /leave/", () => {
    it("เรียก service.submitLeaveRequest ด้วย userId และ body คืน status 201", async () => {
      mockSubmitLeaveRequest.mockResolvedValue({ success: true });

      const formData = new FormData();
      formData.append("startDate", "2025-06-01");
      formData.append("endDate", "2025-06-02");
      formData.append("leaveType", "SICK");
      formData.append("reason", "ไข้หวัด");

      const response = await leave.handle(
        new Request("http://localhost/leave/", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).toBe(201);
      expect(mockSubmitLeaveRequest).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ leaveType: "SICK", reason: "ไข้หวัด" }),
      );
    });

    it("ตอบ 422 เมื่อไม่ส่ง reason มา (validation)", async () => {
      const formData = new FormData();
      formData.append("startDate", "2025-06-01");
      formData.append("endDate", "2025-06-02");
      formData.append("leaveType", "SICK");

      const response = await leave.handle(
        new Request("http://localhost/leave/", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).not.toBe(201);
      expect(mockSubmitLeaveRequest).not.toHaveBeenCalled();
    });
  });

  describe("POST /leave/resubmit", () => {
    it("เรียก service.resubmitLeaveRequests ด้วย userId และ ids", async () => {
      mockResubmitLeaveRequests.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/resubmit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [1, 2] }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockResubmitLeaveRequests).toHaveBeenCalledWith(FAKE_USER.id, [
        1, 2,
      ]);
    });
  });

  describe("GET /leave/history", () => {
    it("เรียก service.getLeaveHistory ด้วย userId และ query", async () => {
      mockGetLeaveHistory.mockResolvedValue({ records: [] });

      const response = await leave.handle(
        new Request(
          "http://localhost/leave/history?year=2025&month=6&type=SICK",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetLeaveHistory).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ year: 2025, month: 6, type: "SICK" }),
      );
    });
  });

  describe("DELETE /leave/:id", () => {
    it("เรียก service.deleteLeaveRequest ด้วย userId และ id จาก params", async () => {
      mockDeleteLeaveRequest.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/10", { method: "DELETE" }),
      );

      expect(response.status).toBe(200);
      expect(mockDeleteLeaveRequest).toHaveBeenCalledWith(FAKE_USER.id, 10);
    });
  });

  describe("POST /leave/bulk-delete", () => {
    it("เรียก service.bulkDeleteLeaveRequests ด้วย userId และ ids", async () => {
      mockBulkDeleteLeaveRequests.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [1, 2, 3] }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockBulkDeleteLeaveRequests).toHaveBeenCalledWith(FAKE_USER.id, [
        1, 2, 3,
      ]);
    });
  });

  describe("POST /leave/:id/approve", () => {
    it("เรียก service.approveLeaveRequest ด้วย userId และ id", async () => {
      mockApproveLeaveRequest.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/5/approve", { method: "POST" }),
      );

      expect(response.status).toBe(200);
      expect(mockApproveLeaveRequest).toHaveBeenCalledWith(FAKE_USER.id, 5);
    });
  });

  describe("POST /leave/bulk-approve", () => {
    it("เรียก service.bulkApproveLeaveRequests ด้วย userId และ ids", async () => {
      mockBulkApproveLeaveRequests.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/bulk-approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [1, 2] }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockBulkApproveLeaveRequests).toHaveBeenCalledWith(
        FAKE_USER.id,
        [1, 2],
      );
    });
  });

  describe("POST /leave/:id/reject", () => {
    it("เรียก service.rejectLeaveRequest ด้วย userId, id และเหตุผล", async () => {
      mockRejectLeaveRequest.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/5/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "ข้อมูลไม่ครบ" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRejectLeaveRequest).toHaveBeenCalledWith(
        FAKE_USER.id,
        5,
        "ข้อมูลไม่ครบ",
      );
    });

    it("ตอบ 422 เมื่อไม่ส่ง reason มา (validation)", async () => {
      const response = await leave.handle(
        new Request("http://localhost/leave/5/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).not.toBe(200);
      expect(mockRejectLeaveRequest).not.toHaveBeenCalled();
    });
  });

  describe("POST /leave/bulk-reject", () => {
    it("เรียก service.bulkRejectLeaveRequests ด้วย userId, ids และเหตุผล", async () => {
      mockBulkRejectLeaveRequests.mockResolvedValue({ success: true });

      const response = await leave.handle(
        new Request("http://localhost/leave/bulk-reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [1, 2], reason: "ไม่ถูกต้อง" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mockBulkRejectLeaveRequests).toHaveBeenCalledWith(
        FAKE_USER.id,
        [1, 2],
        "ไม่ถูกต้อง",
      );
    });
  });

  describe("GET /leave/mentor/requests", () => {
    it("เรียก service.getMentorLeaveRequests ด้วย userId และ query", async () => {
      mockGetMentorLeaveRequests.mockResolvedValue({ data: [], meta: {} });

      const response = await leave.handle(
        new Request("http://localhost/leave/mentor/requests?status=PENDING"),
      );

      expect(response.status).toBe(200);
      expect(mockGetMentorLeaveRequests).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ status: "PENDING" }),
      );
    });
  });

  describe("GET /leave/mentor/audit-list", () => {
    it("เรียก service.getMentorAuditList ด้วย userId และ query", async () => {
      mockGetMentorAuditList.mockResolvedValue({ success: true, data: [] });

      const response = await leave.handle(
        new Request(
          "http://localhost/leave/mentor/audit-list?page=2&limit=5",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetMentorAuditList).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ page: 2, limit: 5 }),
      );
    });
  });

  describe("GET /leave/mentor/audit/:leaveId", () => {
    it("เรียก service.getMentorAuditView ด้วย userId และ leaveId จาก params", async () => {
      mockGetMentorAuditView.mockResolvedValue({ success: true, data: {} });

      const response = await leave.handle(
        new Request("http://localhost/leave/mentor/audit/9"),
      );

      expect(response.status).toBe(200);
      expect(mockGetMentorAuditView).toHaveBeenCalledWith(FAKE_USER.id, 9);
    });
  });
});

afterAll(() => {
  mock.restore();
});
