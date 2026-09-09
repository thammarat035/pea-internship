import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route "scope 3: ประวัติการสมัคร" ของ application module
// (getMyHistory / getStudentHistory / getAllStudentsHistory)
// ---------------------------------------------------------------------------

const mockGetMyHistory = mock();
const mockGetStudentHistory = mock();
const mockGetAllStudentsHistory = mock();

mock.module("../service", () => ({
  ApplicationService: class {
    getMyHistory = mockGetMyHistory;
    getStudentHistory = mockGetStudentHistory;
    getAllStudentsHistory = mockGetAllStudentsHistory;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
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

describe("application routes (history)", () => {
  beforeEach(() => {
    mockGetMyHistory.mockReset();
    mockGetStudentHistory.mockReset();
    mockGetAllStudentsHistory.mockReset();
  });

  describe("GET /applications/history/me", () => {
    it("เรียก service.getMyHistory ด้วย session.userId และ includeCanceled จาก query", async () => {
      mockGetMyHistory.mockResolvedValue([]);

      const response = await application.handle(
        new Request(
          "http://localhost/applications/history/me?includeCanceled=false",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetMyHistory).toHaveBeenCalledWith(FAKE_SESSION.userId, false);
    });

    it("ใช้ includeCanceled=true เป็นค่า default เมื่อไม่ได้ส่ง query มา", async () => {
      mockGetMyHistory.mockResolvedValue([]);

      await application.handle(
        new Request("http://localhost/applications/history/me"),
      );

      expect(mockGetMyHistory).toHaveBeenCalledWith(FAKE_SESSION.userId, true);
    });
  });

  describe("GET /applications/history/:studentUserId", () => {
    it("เรียก service.getStudentHistory ด้วย session.userId, studentUserId และ includeCanceled", async () => {
      mockGetStudentHistory.mockResolvedValue([]);

      const response = await application.handle(
        new Request(
          "http://localhost/applications/history/student-uuid-1?includeCanceled=false",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetStudentHistory).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        "student-uuid-1",
        false,
      );
    });
  });

  describe("GET /applications/history", () => {
    it("เรียก service.getAllStudentsHistory ด้วย session.userId และ query ทั้งก้อน", async () => {
      mockGetAllStudentsHistory.mockResolvedValue({ data: [], meta: {} });

      const response = await application.handle(
        new Request(
          "http://localhost/applications/history?status=PENDING_REVIEW&page=2&limit=5&q=สมชาย",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetAllStudentsHistory).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        expect.objectContaining({
          status: "PENDING_REVIEW",
          page: 2,
          limit: 5,
          q: "สมชาย",
        }),
      );
    });

    it("ใช้ page=1, limit=20, includeCanceled=true เป็นค่า default เมื่อไม่ส่ง query มา", async () => {
      mockGetAllStudentsHistory.mockResolvedValue({ data: [], meta: {} });

      await application.handle(
        new Request("http://localhost/applications/history"),
      );

      expect(mockGetAllStudentsHistory).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        expect.objectContaining({ page: 1, limit: 20, includeCanceled: true }),
      );
    });
  });
});

afterAll(() => {
  mock.restore();
});
