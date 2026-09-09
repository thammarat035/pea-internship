import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 2 endpoint ของ manualEndInternships โดย mock service ทั้งคลาส
// ---------------------------------------------------------------------------

const mockGetInternshipEndHistory = mock();
const mockUpdateInternshipStatus = mock();

mock.module("../service", () => ({
  OwnerStudentStatusService: class {
    getInternshipEndHistory = mockGetInternshipEndHistory;
    updateInternshipStatus = mockUpdateInternshipStatus;
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

const { ownerStudents } = await import("../index");

describe("owner/students routes", () => {
  beforeEach(() => {
    mockGetInternshipEndHistory.mockReset();
    mockUpdateInternshipStatus.mockReset();
  });

  it("GET /:studentUserId/internship-history เรียก service.getInternshipEndHistory ด้วย session.userId และ studentUserId", async () => {
    mockGetInternshipEndHistory.mockResolvedValue([]);

    const response = await ownerStudents.handle(
      new Request(
        "http://localhost/owner/students/student-1/internship-history",
      ),
    );

    expect(response.status).toBe(200);
    expect(mockGetInternshipEndHistory).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      "student-1",
    );
  });

  it("PUT /:studentUserId/internship-status เรียก service.updateInternshipStatus ด้วย session.userId, studentUserId และ body", async () => {
    mockUpdateInternshipStatus.mockResolvedValue({
      studentUserId: "student-1",
      internshipStatus: "COMPLETE",
    });

    const response = await ownerStudents.handle(
      new Request(
        "http://localhost/owner/students/student-1/internship-status",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "COMPLETE" }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateInternshipStatus).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      "student-1",
      expect.objectContaining({ status: "COMPLETE" }),
    );
  });

  it("ตอบ 422 เมื่อ status ไม่อยู่ใน union ที่อนุญาต (validation)", async () => {
    const response = await ownerStudents.handle(
      new Request(
        "http://localhost/owner/students/student-1/internship-status",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "UNKNOWN" }),
        },
      ),
    );

    expect(response.status).not.toBe(200);
    expect(mockUpdateInternshipStatus).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
});
