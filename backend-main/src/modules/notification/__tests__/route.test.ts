import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 4 endpoint ที่เปิดใช้งานจริงของ notification module
// (create/createMany/getAdminUserIds/getOwnerUserIdsByDepartment ไม่ถูก mount
// เป็น route เลย - เป็น method ที่ตั้งใจไว้ให้ module อื่นเรียกใช้ แต่จริงๆ
// ไม่มี module ไหนเรียกเลย เทสแยกไว้ในไฟล์ service.db.test.ts)
// ---------------------------------------------------------------------------

const mockGetMyNotifications = mock();
const mockMarkRead = mock();
const mockMarkAllRead = mock();
const mockDeleteNotification = mock();

mock.module("../service", () => ({
  NotificationService: class {
    getMyNotifications = mockGetMyNotifications;
    markRead = mockMarkRead;
    markAllRead = mockMarkAllRead;
    deleteNotification = mockDeleteNotification;
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

const { notification } = await import("../index");

describe("notification routes", () => {
  beforeEach(() => {
    mockGetMyNotifications.mockReset();
    mockMarkRead.mockReset();
    mockMarkAllRead.mockReset();
    mockDeleteNotification.mockReset();
  });

  it("GET /notifications/ เรียก service.getMyNotifications ด้วย session.userId และ query", async () => {
    mockGetMyNotifications.mockResolvedValue([]);

    const response = await notification.handle(
      new Request("http://localhost/notifications/?unreadOnly=true&limit=5"),
    );

    expect(response.status).toBe(200);
    expect(mockGetMyNotifications).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ unreadOnly: true, limit: 5 }),
    );
  });

  it("PUT /notifications/:id/read เรียก service.markRead ด้วย session.userId, id (ตัวเลข) และ isRead", async () => {
    mockMarkRead.mockResolvedValue({ id: 1, isRead: true });

    const response = await notification.handle(
      new Request("http://localhost/notifications/1/read", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockMarkRead).toHaveBeenCalledWith(FAKE_SESSION.userId, 1, true);
  });

  it("PUT /notifications/read-all เรียก service.markAllRead ด้วย session.userId", async () => {
    mockMarkAllRead.mockResolvedValue({ success: true });

    const response = await notification.handle(
      new Request("http://localhost/notifications/read-all", { method: "PUT" }),
    );

    expect(response.status).toBe(200);
    expect(mockMarkAllRead).toHaveBeenCalledWith(FAKE_SESSION.userId);
  });

  it("DELETE /notifications/delete/:id เรียก service.deleteNotification ด้วย session.userId และ id (ตัวเลข)", async () => {
    mockDeleteNotification.mockResolvedValue({ success: true });

    const response = await notification.handle(
      new Request("http://localhost/notifications/delete/1", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDeleteNotification).toHaveBeenCalledWith(FAKE_SESSION.userId, 1);
  });
});

afterAll(() => {
  mock.restore();
});
