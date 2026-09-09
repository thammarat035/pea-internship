import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const mockFindAll = mock();
const mockCreate = mock();
const mockUpdate = mock();
const mockDelete = mock();

mock.module("../service", () => ({
  RoleService: class {
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
    role: () => ({ resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }) }),
  }),
}));

const { role } = await import("../index");

describe("role routes", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("GET /role/ เรียก service.findAll", async () => {
    mockFindAll.mockResolvedValue([{ id: 1, name: "Admin" }]);

    const response = await role.handle(new Request("http://localhost/role/"));

    expect(response.status).toBe(200);
    expect(mockFindAll).toHaveBeenCalledTimes(1);
  });

  it("POST /role/ เรียก service.create ด้วย body คืน status 201", async () => {
    mockCreate.mockResolvedValue({ id: 1, name: "Intern" });

    const response = await role.handle(
      new Request("http://localhost/role/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Intern" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Intern" }),
    );
  });

  it("PUT /role/:id เรียก service.update ด้วย id (ตัวเลข) และ body", async () => {
    mockUpdate.mockResolvedValue({ id: 1, name: "ใหม่" });

    const response = await role.handle(
      new Request("http://localhost/role/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ใหม่" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ name: "ใหม่" }));
  });

  it("DELETE /role/:id เรียก service.delete ด้วย id (ตัวเลข)", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const response = await role.handle(
      new Request("http://localhost/role/1", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(1);
  });
});

afterAll(() => {
  mock.restore();
});
