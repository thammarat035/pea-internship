import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// แนวคิดของไฟล์นี้: เทส "route" แยกออกจาก "service" เหมือนที่เราแยกเทส
// AdminNavbar.tsx ออกจาก child component ฝั่ง frontend
//   - ไม่สนใจว่า getDashboardStats() คำนวณถูกไหม (เทสไปแล้วในไฟล์ service.test.ts)
//   - สนใจแค่ว่า route ทำงานถูกไหม: รับ query param มาแปลงถูกไหม, เรียก service
//     ถูกฟังก์ชันไหม, ตอบ status code ถูกไหม
//   - ไม่ต้องมี session/database จริง เพราะ mock ทั้ง auth middleware และ service ทิ้ง
//
// Elysia มีเมธอด .handle(request) ให้ยิง request เข้า route ได้ตรงๆ โดยไม่ต้อง
// เปิด server จริงเลย (ไม่ต้อง .listen()) เหมือน supertest ของฝั่ง Express
// แต่เบากว่าเยอะเพราะเป็นฟีเจอร์ในตัว framework เอง
// ---------------------------------------------------------------------------

const mockGetDashboardStats = mock();
const mockGetTopUnits = mock();

// mock ทั้งคลาส AdminDashboardService ทิ้งไปเลย ไม่ให้แตะ db จริง
mock.module("../service", () => ({
  AdminDashboardService: class {
    getDashboardStats = mockGetDashboardStats;
    getTopUnits = mockGetTopUnits;
  },
}));

// mock isAuthenticated ให้ "ผ่านเสมอ" โดยไม่เช็ค session จริง เพื่อแยกการเทส
// เรื่อง auth ออกไปเป็นอีกไฟล์ต่างหาก (auth.middleware.test.ts)
mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({
        user: { id: "fake-user", roleId: 1 },
        session: { id: "fake-session" },
      }),
    },
    role: () => ({
      resolve: () => ({
        user: { id: "fake-user", roleId: 1 },
        session: { id: "fake-session" },
      }),
    }),
  }),
}));

const { adminDashboard } = await import("../index");

describe("adminDashboard routes", () => {
  beforeEach(() => {
    mockGetDashboardStats.mockReset();
    mockGetTopUnits.mockReset();
  });

  describe("GET /admin-dashboard/stats", () => {
    it("เรียก service.getDashboardStats ด้วย month/year จาก query param และคืน status 200", async () => {
      mockGetDashboardStats.mockResolvedValue({
        totalActive: 5,
        leaveRate: 10,
        lateRate: 20,
        absentRate: 5,
        period: { year: 2025, month: 3 },
      });

      const response = await adminDashboard.handle(
        new Request(
          "http://localhost/admin-dashboard/stats?month=3&year=2025",
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetDashboardStats).toHaveBeenCalledWith(3, 2025);
      expect(body.totalActive).toBe(5);
    });

    it("ใช้เดือน/ปีปัจจุบันเป็นค่า default เมื่อไม่ได้ส่ง query param มา", async () => {
      mockGetDashboardStats.mockResolvedValue({
        totalActive: 0,
        leaveRate: 0,
        lateRate: 0,
        absentRate: 0,
        period: { year: 2025, month: 1 },
      });

      const now = new Date();
      const expectedMonth = now.getMonth() + 1;
      const expectedYear = now.getFullYear();

      await adminDashboard.handle(
        new Request("http://localhost/admin-dashboard/stats"),
      );

      expect(mockGetDashboardStats).toHaveBeenCalledWith(
        expectedMonth,
        expectedYear,
      );
    });

    it("ตอบ 422 (validation error) เมื่อส่ง month นอกช่วง 1-12", async () => {
      const response = await adminDashboard.handle(
        new Request(
          "http://localhost/admin-dashboard/stats?month=13&year=2025",
        ),
      );

      // Elysia ปฏิเสธ request ตั้งแต่ชั้น validation ก่อนถึง handler เลย
      expect(response.status).not.toBe(200);
      expect(mockGetDashboardStats).not.toHaveBeenCalled();
    });

    it("ตอบ 422 เมื่อส่ง month เป็นค่าที่ไม่ใช่ตัวเลข", async () => {
      const response = await adminDashboard.handle(
        new Request(
          "http://localhost/admin-dashboard/stats?month=abc&year=2025",
        ),
      );

      expect(response.status).not.toBe(200);
      expect(mockGetDashboardStats).not.toHaveBeenCalled();
    });
  });

  describe("GET /admin-dashboard/top-units", () => {
    it("เรียก service.getTopUnits ด้วย month/year จาก query param และคืน status 200", async () => {
      mockGetTopUnits.mockResolvedValue({
        leaveTop: [{ name: "IT", value: 3 }],
        lateTop: [],
        absentTop: [],
        period: { year: 2025, month: 6 },
      });

      const response = await adminDashboard.handle(
        new Request(
          "http://localhost/admin-dashboard/top-units?month=6&year=2025",
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetTopUnits).toHaveBeenCalledWith(6, 2025);
      expect(body.leaveTop).toEqual([{ name: "IT", value: 3 }]);
    });
  });
});

// ---------------------------------------------------------------------------
// สำคัญมาก: Bun รันทุกไฟล์เทสในโปรเซสเดียวกัน (ต่างจาก Jest ที่แยกแต่ละไฟล์
// ออกจากกันให้อัตโนมัติ) mock.module() ที่เรียกไว้ด้านบนของไฟล์นี้จะ "ค้างอยู่"
// ข้ามไปยังไฟล์เทสอื่นที่รันถัดไปด้วย ถ้าไม่ล้างทิ้ง ไฟล์อื่นที่ import
// "../service" หรือ "@/middlewares/auth.middleware" ตัวจริงจะได้ของปลอมจากที่นี่ไปใช้แทน
//
// afterAll(() => mock.restore()) คืนค่า module ทั้งหมดกลับเป็นของจริงหลังจาก
// เทสในไฟล์นี้ทำงานครบทุกตัวแล้ว เพื่อไม่ให้ไปกระทบไฟล์เทสอื่นที่รันต่อจากนี้
// ---------------------------------------------------------------------------
afterAll(() => {
  mock.restore();
});