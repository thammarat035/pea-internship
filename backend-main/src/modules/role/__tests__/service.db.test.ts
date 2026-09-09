import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = { roles: makeQueryMock() };

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock();
const mockUpdateWhere = mock((_where?: unknown) => ({
  returning: mockUpdateReturning,
}));
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteReturning = mock();
const mockDeleteWhere = mock((_where?: unknown) => ({
  returning: mockDeleteReturning,
}));
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function postgresError(code: string) {
  const err = new Error(`postgres error ${code}`);
  (err as unknown as { cause: unknown }).cause = { code };
  return err;
}

const dbMock = {
  query: queryMocks,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
};
mock.module("@/db", () => ({ db: dbMock }));

const { RoleService } = await import("../service");
const { BadRequestError, ConflictError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  queryMocks.roles.findFirst.mockReset();
  queryMocks.roles.findMany.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteReturning.mockReset();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("RoleService.findAll", () => {
  it("คืนรายการบทบาททั้งหมด", async () => {
    const service = new RoleService();
    queryMocks.roles.findMany.mockResolvedValueOnce([{ id: 1, name: "Admin" }]);

    const result = await service.findAll();

    expect(result).toMatchObject([{ id: 1, name: "Admin" }]);
  });
});

describe("RoleService.create", () => {
  it("สร้างบทบาทใหม่สำเร็จ", async () => {
    const service = new RoleService();
    mockInsertReturning.mockResolvedValueOnce([{ id: 1, name: "Intern" }]);

    const result = await service.create({ name: "Intern" });

    expect(result).toMatchObject({ name: "Intern" });
  });

  it("throws ConflictError เมื่อชื่อบทบาทซ้ำ (postgres unique violation 23505)", async () => {
    const service = new RoleService();
    mockInsertReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(service.create({ name: "Intern" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres unique violation", async () => {
    const service = new RoleService();
    mockInsertReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(service.create({ name: "Intern" })).rejects.toThrow("unexpected db error");
  });
});

describe("RoleService.update", () => {
  it("แก้ไขบทบาทสำเร็จ", async () => {
    const service = new RoleService();
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1, name: "ใหม่" }]);

    const result = await service.update(1, { name: "ใหม่" });

    expect(result).toMatchObject({ name: "ใหม่" });
  });

  it("throws NotFoundError เมื่อไม่พบบทบาทที่จะแก้ไข", async () => {
    const service = new RoleService();
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(service.update(999, { name: "ใหม่" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError เมื่อแก้ไขแล้วชื่อชนกับบทบาทอื่น", async () => {
    const service = new RoleService();
    mockUpdateReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(service.update(1, { name: "ซ้ำ" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("RoleService.delete", () => {
  it("ลบบทบาทสำเร็จ", async () => {
    const service = new RoleService();
    mockDeleteReturning.mockResolvedValueOnce([{ id: 1 }]);

    const result = await service.delete(1);

    expect(result).toEqual({ success: true, message: "ลบข้อมูลบทบาทเรียบร้อยแล้ว" });
  });

  it("throws NotFoundError เมื่อไม่พบบทบาทที่จะลบ", async () => {
    const service = new RoleService();
    mockDeleteReturning.mockResolvedValueOnce([]);

    expect(service.delete(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อมีผู้ใช้งานสังกัดบทบาทนี้อยู่ (foreign key violation 23503)", async () => {
    const service = new RoleService();
    mockDeleteReturning.mockRejectedValueOnce(postgresError("23503"));

    expect(service.delete(1)).rejects.toBeInstanceOf(BadRequestError);
  });
});
