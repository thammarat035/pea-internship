import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส InstitutionService ทั้ง 4 เมธอด — โครงสร้างเดียวกับ department module
// เป๊ะ (CRUD ธรรมดา + แปลง Postgres error code เป็น exception type)
//
// ข้อสังเกต: create() ไม่เรียก assertUserExists() เลย (มีบรรทัดคอมเมนต์ไว้ใน
// source `// await this.assertUserExists(userId);`) ต่างจาก update()/delete()
// ที่เรียกจริง เทสด้านล่างจึงไม่มีเคส ForbiddenError สำหรับ create()
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

const { InstitutionService } = await import("../service");
const { BadRequestError, ConflictError, ForbiddenError } = await import(
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

describe("InstitutionService.findAll", () => {
  it("คืนข้อมูลสถาบันพร้อม pagination meta", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, name: "ม.เกษตรศาสตร์" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));

    const result = await service.findAll({});

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1, hasNextPage: false });
  });

  it("รับ filter search และ type พร้อมกันโดยไม่ error", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }]));

    const result = await service.findAll({ search: "เกษตร", type: "UNIVERSITY" });

    expect(result.data).toEqual([]);
  });

  it("hasNextPage เป็น true เมื่อยังมีหน้าถัดไป", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 45 }]));

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.meta).toEqual({ total: 45, page: 1, limit: 20, totalPages: 3, hasNextPage: true });
  });
});

describe("InstitutionService.create", () => {
  it("สร้างสำเร็จ (ไม่มีการเช็คสิทธิ์ผู้ใช้เลย)", async () => {
    const service = new InstitutionService();
    mockInsertReturning.mockResolvedValueOnce([
      { id: 1, institutionsType: "UNIVERSITY", name: "ม.เกษตรศาสตร์" },
    ]);

    const result = await service.create({
      institutionsType: "UNIVERSITY",
      name: "ม.เกษตรศาสตร์",
    });

    expect(result).toMatchObject({ name: "ม.เกษตรศาสตร์" });
  });

  it("throws ConflictError เมื่อชื่อสถาบันซ้ำ (postgres unique violation 23505)", async () => {
    const service = new InstitutionService();
    mockInsertReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(
      service.create({ institutionsType: "UNIVERSITY", name: "ซ้ำ" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres unique violation", async () => {
    const service = new InstitutionService();
    mockInsertReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(
      service.create({ institutionsType: "UNIVERSITY", name: "x" }),
    ).rejects.toThrow("unexpected db error");
  });
});

describe("InstitutionService.update", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.update("user-1", 1, { name: "ใหม่" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("อัปเดตสำเร็จ", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1, name: "ใหม่" }]);

    const result = await service.update("admin-1", 1, { name: "ใหม่" });

    expect(result).toMatchObject({ name: "ใหม่" });
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("updatedAt");
  });

  it("throws NotFoundError เมื่อไม่พบสถาบันที่จะแก้ไข", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.update("admin-1", 999, { name: "ใหม่" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError เมื่อแก้ไขแล้วชื่อชนกับข้อมูลซ้ำ", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockUpdateReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(
      service.update("admin-1", 1, { name: "ซ้ำ" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres unique violation", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockUpdateReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(
      service.update("admin-1", 1, { name: "x" }),
    ).rejects.toThrow("unexpected db error");
  });
});

describe("InstitutionService.delete", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.delete("user-1", 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ลบสำเร็จ", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockDeleteReturning.mockResolvedValueOnce([{ id: 1 }]);

    const result = await service.delete("admin-1", 1);

    expect(result).toEqual({ success: true, message: "ลบข้อมูลสถาบันเรียบร้อยแล้ว" });
  });

  it("throws NotFoundError เมื่อไม่พบสถาบันที่จะลบ", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockDeleteReturning.mockResolvedValueOnce([]);

    expect(service.delete("admin-1", 999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อมีข้อมูลอื่นอ้างอิงอยู่ (foreign key violation 23503)", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockDeleteReturning.mockRejectedValueOnce(postgresError("23503"));

    expect(service.delete("admin-1", 1)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("โยน error เดิมต่อไปเมื่อไม่ใช่ postgres foreign key violation", async () => {
    const service = new InstitutionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "admin-1" }]));
    mockDeleteReturning.mockRejectedValueOnce(new Error("unexpected db error"));

    expect(service.delete("admin-1", 1)).rejects.toThrow("unexpected db error");
  });
});
