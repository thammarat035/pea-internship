import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// module นี้ export จาก route.ts (ไม่ใช่ index.ts เหมือนโมดูลอื่น) และไม่มี
// .use(isAuthenticated) เลย - เป็น endpoint สาธารณะทั้งหมด (แค่ query ชื่อ
// หน่วยงานแบบเร็วด้วย dept_sap ไม่ใช่ข้อมูลอ่อนไหว) จึงไม่ต้อง mock
// auth.middleware เลยในไฟล์นี้
// ---------------------------------------------------------------------------

const mockFindById = mock();

mock.module("../service", () => ({
  DepartmentTicketService: class {
    findById = mockFindById;
  },
}));

const { departmentTicketRoutes } = await import("../route");

describe("department_ticket routes", () => {
  beforeEach(() => {
    mockFindById.mockReset();
  });

  it("GET /department_ticket/:id เรียก service.findById ด้วย id (ตัวเลข) และตั้ง Cache-Control header", async () => {
    mockFindById.mockResolvedValue({ deptSap: 10, deptShort: "IT" });

    const response = await departmentTicketRoutes.handle(
      new Request("http://localhost/department_ticket/10"),
    );

    expect(response.status).toBe(200);
    expect(mockFindById).toHaveBeenCalledWith(10);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});

afterAll(() => {
  mock.restore();
});
