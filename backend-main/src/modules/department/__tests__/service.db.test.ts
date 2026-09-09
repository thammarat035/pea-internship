import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส DepartmentService ทั้ง 4 เมธอด (findAll, create, update, delete)
// จุดที่ต่างจากโมดูลอื่น: ไม่มี transaction เลย เป็น CRUD ธรรมดา และมี
// try/catch แปลง Postgres error code (23505 = unique violation,
// 23503 = foreign key violation) เป็น exception type ที่เหมาะสม
// (ConflictError / BadRequestError) จำลอง postgres error ด้วยการโยน object
// ที่มี .cause = {code: "..."} ตามที่ isPostgresError() ตรวจสอบ
// ---------------------------------------------------------------------------

const mockSelect = mock();

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

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function postgresError(code: string) {
  const err = new Error(`postgres error ${code}`);
  (err as unknown as { cause: unknown }).cause = { code };
  return err;
}

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
};

mock.module("@/db", () => ({ db: dbMock }));

const { DepartmentService } = await import("../service");
const { BadRequestError, ConflictError } = await import(
  "@/common/exceptions"
);
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockSelect.mockReset();
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

describe("DepartmentService.findAll", () => {
  it("คืนข้อมูลแผนกพร้อม pagination meta", async () => {
    const service = new DepartmentService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, deptSap: 10, deptShort: "IT" }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));

    const result = await service.findAll({});

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1, hasNextPage: false });
  });

  it("รับ query filter (office, search หลายคำ) โดยไม่ error", async () => {
    const service = new DepartmentService();
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }]));

    const result = await service.findAll({ office: 5, search: "IT ฝ่าย" });

    expect(result.data).toEqual([]);
  });

  it("hasNextPage เป็น true เมื่อยังมีหน้าถัดไป", async () => {
    const service = new DepartmentService();
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 100 }]));

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.meta).toEqual({ total: 100, page: 1, limit: 20, totalPages: 5, hasNextPage: true });
  });
});

describe("DepartmentService.create", () => {
  it("สร้างสำเร็จพร้อมค่า default isActive=true, isDeleted=false", async () => {
    const service = new DepartmentService();
    mockInsertReturning.mockResolvedValueOnce([
      { deptSap: 10, isActive: true, isDeleted: false },
    ]);

    await service.create({ deptSap: 10, officeId: 1, updatedBy: "admin-1" } as never);

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      isActive: true,
      isDeleted: false,
    });
  });

  it("ใช้ค่า isActive/isDeleted ที่ระบุมาแทนค่า default เมื่อส่งมา", async () => {
    const service = new DepartmentService();
    mockInsertReturning.mockResolvedValueOnce([{ deptSap: 10 }]);

    await service.create({
      deptSap: 10,
      officeId: 1,
      updatedBy: "admin-1",
      isActive: false,
      isDeleted: true,
    } as never);

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      isActive: false,
      isDeleted: true,
    });
  });

  it("throws ConflictError เมื่อ deptSap ซ้ำ (postgres unique violation 23505)", async () => {
    const service = new DepartmentService();
    mockInsertReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(
      service.create({ deptSap: 10, officeId: 1, updatedBy: "admin-1" } as never),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres unique violation", async () => {
    const service = new DepartmentService();
    mockInsertReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(
      service.create({ deptSap: 10, officeId: 1, updatedBy: "admin-1" } as never),
    ).rejects.toThrow("unexpected db error");
  });
});

describe("DepartmentService.update", () => {
  it("อัปเดตสำเร็จ", async () => {
    const service = new DepartmentService();
    mockUpdateReturning.mockResolvedValueOnce([{ deptSap: 10, deptShort: "ใหม่" }]);

    const result = await service.update(10, { deptShort: "ใหม่" });

    expect(result).toMatchObject({ deptShort: "ใหม่" });
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("updatedAt");
  });

  it("throws NotFoundError เมื่อไม่พบแผนกที่จะแก้ไข", async () => {
    const service = new DepartmentService();
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.update(999, { deptShort: "ใหม่" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError เมื่อแก้ไขแล้วชนกับข้อมูลซ้ำ", async () => {
    const service = new DepartmentService();
    mockUpdateReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(
      service.update(10, { deptSap: 99 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres unique violation", async () => {
    const service = new DepartmentService();
    mockUpdateReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(
      service.update(10, { deptShort: "x" }),
    ).rejects.toThrow("unexpected db error");
  });
});

describe("DepartmentService.delete", () => {
  it("ลบสำเร็จ", async () => {
    const service = new DepartmentService();
    mockDeleteReturning.mockResolvedValueOnce([{ deptSap: 10 }]);

    const result = await service.delete(10);

    expect(result).toEqual({ success: true, message: "ลบข้อมูลแผนกเรียบร้อยแล้ว" });
  });

  it("throws NotFoundError เมื่อไม่พบแผนกที่จะลบ", async () => {
    const service = new DepartmentService();
    mockDeleteReturning.mockResolvedValueOnce([]);

    expect(service.delete(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อมีข้อมูลอื่นอ้างอิงอยู่ (foreign key violation 23503)", async () => {
    const service = new DepartmentService();
    mockDeleteReturning.mockRejectedValueOnce(postgresError("23503"));

    expect(service.delete(10)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres foreign key violation", async () => {
    const service = new DepartmentService();
    mockDeleteReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(service.delete(10)).rejects.toThrow("unexpected db error");
  });
});
