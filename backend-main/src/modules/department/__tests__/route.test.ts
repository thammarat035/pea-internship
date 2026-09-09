import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 4 endpoint ของ department module โดย mock DepartmentService
// ทั้งคลาส
//
// ข้อสังเกตสำคัญ: PUT /dept/:id ไม่มีทั้ง `auth: true` และ `role: [...]` เลย
// (ต่างจาก POST/DELETE ที่มี role: 1) แปลว่า macro resolver ของ isAuthenticated
// จะไม่ถูกเรียกเลยสำหรับ route นี้ - handler ก็ไม่ได้อ่าน session/user เลยด้วย
// เทสด้านล่างจึงเรียก PUT โดยไม่แนบ auth header ใดๆ เพื่อพิสูจน์พฤติกรรม
// ปัจจุบันตามจริง (ไม่ได้แปลว่าเป็นพฤติกรรมที่ตั้งใจ - ควรคุยกับทีมว่า
// endpoint นี้ควรมี role restriction เหมือน POST/DELETE หรือไม่)
// ---------------------------------------------------------------------------

const mockFindAll = mock();
const mockCreate = mock();
const mockUpdate = mock();
const mockDelete = mock();

mock.module("../service", () => ({
  DepartmentService: class {
    findAll = mockFindAll;
    create = mockCreate;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

const FAKE_USER = { id: "fake-admin-id", roleId: 1 };
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

const { department } = await import("../index");

describe("department routes", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("GET /dept/ เรียก service.findAll ด้วย query", async () => {
    mockFindAll.mockResolvedValue({ data: [], meta: {} });

    const response = await department.handle(
      new Request("http://localhost/dept/?search=IT&office=1"),
    );

    expect(response.status).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: "IT", office: 1 }),
    );
  });

  it("POST /dept/ เรียก service.create ด้วย body คืน status 201", async () => {
    mockCreate.mockResolvedValue({ deptSap: 10 });

    const response = await department.handle(
      new Request("http://localhost/dept/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptSap: 10, officeId: 1, updatedBy: "admin-1" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ deptSap: 10, officeId: 1 }),
    );
  });

  it("PUT /dept/:id เรียก service.update ด้วย id (ตัวเลข) และ body แม้ไม่แนบ auth header เลย", async () => {
    mockUpdate.mockResolvedValue({ deptSap: 10, deptShort: "ใหม่" });

    const response = await department.handle(
      new Request("http://localhost/dept/10", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptShort: "ใหม่" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ deptShort: "ใหม่" }),
    );
  });

  it("DELETE /dept/:id เรียก service.delete ด้วย id (ตัวเลข)", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const response = await department.handle(
      new Request("http://localhost/dept/10", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(10);
  });
});

afterAll(() => {
  mock.restore();
});
