import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 2 endpoint ของ application-complete-modal โดย mock service
// ทั้งคลาส — โมดูลนี้เล็กและตรงไปตรงมา (เฉพาะนักศึกษา role [3])
// ---------------------------------------------------------------------------

const mockGetModalStatus = mock();
const mockAcknowledgeModal = mock();

mock.module("../service", () => ({
  ApplicationCompleteModalService: class {
    getModalStatus = mockGetModalStatus;
    acknowledgeModal = mockAcknowledgeModal;
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

const { applicationCompleteModal } = await import("../index");

describe("application-complete-modal routes", () => {
  beforeEach(() => {
    mockGetModalStatus.mockReset();
    mockAcknowledgeModal.mockReset();
  });

  describe("GET /student/application-complete-modal/", () => {
    it("เรียก service.getModalStatus ด้วย session.userId คืน status 200", async () => {
      mockGetModalStatus.mockResolvedValue({
        shouldShow: true,
        applicationStatusId: 10,
        title: "การฝึกงานเสร็จสิ้นแล้ว",
        message: "กรุณากดรับทราบเพื่อปิดข้อความนี้",
      });

      const response = await applicationCompleteModal.handle(
        new Request("http://localhost/student/application-complete-modal/"),
      );

      expect(response.status).toBe(200);
      expect(mockGetModalStatus).toHaveBeenCalledWith(FAKE_SESSION.userId);
      const body = await response.json();
      expect(body.shouldShow).toBe(true);
    });
  });

  describe("POST /student/application-complete-modal/acknowledge", () => {
    it("เรียก service.acknowledgeModal ด้วย session.userId คืน status 200", async () => {
      mockAcknowledgeModal.mockResolvedValue({
        message: "รับทราบสถานะเรียบร้อยแล้ว",
      });

      const response = await applicationCompleteModal.handle(
        new Request(
          "http://localhost/student/application-complete-modal/acknowledge",
          { method: "POST" },
        ),
      );

      expect(response.status).toBe(200);
      expect(mockAcknowledgeModal).toHaveBeenCalledWith(FAKE_SESSION.userId);
    });
  });
});

afterAll(() => {
  mock.restore();
});
