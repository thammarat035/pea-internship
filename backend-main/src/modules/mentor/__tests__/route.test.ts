import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 2 endpoint ของ mentor dashboard โดย mock MentorService ทั้งคลาส
// (pattern เดียวกับ check-time/leave-requests) เพื่อโฟกัสแค่ "ชั้น HTTP":
//   - รับ query/params มาแปลง/ส่งต่อให้ service ถูก argument ไหม (โดยเฉพาะ
//     studentId ที่เป็น t.String ไม่ใช่ตัวเลข ต่างจาก id ของ module อื่น)
//   - ตอบ status code ถูกไหม
// ---------------------------------------------------------------------------

const mockGetStudents = mock();
const mockGetStudentDetail = mock();

mock.module("../service", () => ({
  MentorService: class {
    getStudents = mockGetStudents;
    getStudentDetail = mockGetStudentDetail;
  },
}));

const FAKE_USER = { id: "fake-mentor-id", roleId: 2 };

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

const { mentor } = await import("../index");

describe("mentor routes", () => {
  beforeEach(() => {
    mockGetStudents.mockReset();
    mockGetStudentDetail.mockReset();
  });

  describe("GET /mentor/students", () => {
    it("เรียก service.getStudents ด้วย userId และ query คืน status 200", async () => {
      mockGetStudents.mockResolvedValue({ data: [], meta: {} });

      const response = await mentor.handle(
        new Request(
          "http://localhost/mentor/students?search=สมชาย&status=active",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetStudents).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ search: "สมชาย", status: "active" }),
      );
    });

    it("ใช้ page=1, limit=10, viewType=MINE เป็นค่า default เมื่อไม่ส่ง query มา", async () => {
      mockGetStudents.mockResolvedValue({ data: [], meta: {} });

      await mentor.handle(new Request("http://localhost/mentor/students"));

      expect(mockGetStudents).toHaveBeenCalledWith(
        FAKE_USER.id,
        expect.objectContaining({ page: 1, limit: 10, viewType: "MINE" }),
      );
    });
  });

  describe("GET /mentor/students/:studentId", () => {
    it("เรียก service.getStudentDetail ด้วย userId, studentId (string) และ query", async () => {
      mockGetStudentDetail.mockResolvedValue({ profile: {} });

      const response = await mentor.handle(
        new Request(
          "http://localhost/mentor/students/student-uuid-123?page=2&limit=5",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetStudentDetail).toHaveBeenCalledWith(
        FAKE_USER.id,
        "student-uuid-123",
        expect.objectContaining({ page: 2, limit: 5 }),
      );
    });
  });
});

afterAll(() => {
  mock.restore();
});
