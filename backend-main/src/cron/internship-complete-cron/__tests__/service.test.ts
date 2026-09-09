import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: ปิดจบการฝึกงานอัตโนมัติให้นักศึกษา ACTIVE/EXTENDED ที่ผ่านมา
// ครบ "3 วันทำการ" หลังวันสิ้นสุด (endDate เดิม หรือ newEndDate ถ้ามีการขยาย
// เวลาอนุมัติแล้ว) — ตรรกะการนับวันทำการ (ข้ามเสาร์-อาทิตย์) ทำเป็น raw SQL
// (generate_series) รันในฝั่ง Postgres ตรงๆ ไม่ใช่ JavaScript จึง "เทสไม่ได้"
// ด้วย unit test แบบ mock (ต้องมี Postgres จริงถึงจะยืนยันตัวเลขวันได้)
// เทสนี้จึงเทสแค่ "การประกอบผลลัพธ์ใน JS" (รวม active+extended, insert
// ประวัติ, นับจำนวน) โดยสมมติว่า query คืนแถวที่ "ตรงเงื่อนไข SQL แล้ว" มาให้
// ---------------------------------------------------------------------------

const mockUpdateReturning = mock();
const mockUpdateWhere = mock((_w?: unknown) => ({ returning: mockUpdateReturning }));
const mockUpdateSet = mock((_s?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockInsertValues = mock((_v?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.then = (resolve: (v: T) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const mockSelect = mock(() => makeChainable([]));

const dbMock = {
  select: mockSelect,
  update: mockUpdate,
  insert: mockInsert,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};
mock.module("@/db", () => ({ db: dbMock }));

const { InternshipCompleteCronService } = await import("../service");

beforeEach(() => {
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("InternshipCompleteCronService.updateToComplete", () => {
  it("ไม่มีใครครบกำหนดเลย -> ทุก count เป็น 0 และไม่ insert ประวัติ", async () => {
    const service = new InternshipCompleteCronService();
    mockUpdateReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.updateToComplete();

    expect(result).toEqual({ activeCompleted: 0, extendedCompleted: 0, historyCreated: 0 });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("รวมนักศึกษาที่ครบกำหนดจากทั้งฝั่ง ACTIVE ปกติและฝั่งที่เคยขยายเวลา (EXTENDED) เข้าด้วยกัน", async () => {
    const service = new InternshipCompleteCronService();
    mockUpdateReturning
      .mockResolvedValueOnce([{ studentProfileId: 1, userId: "student-1" }]) // active -> complete
      .mockResolvedValueOnce([{ studentProfileId: 2, userId: "student-2" }]); // extended -> complete

    const result = await service.updateToComplete();

    expect(result).toEqual({ activeCompleted: 1, extendedCompleted: 1, historyCreated: 2 });
    const historyPayload = mockInsertValues.mock.calls[0][0] as Array<{
      studentProfileId: number;
      status: string;
      changedBy: string;
    }>;
    expect(historyPayload).toHaveLength(2);
    expect(historyPayload[0]).toMatchObject({ studentProfileId: 1, status: "COMPLETE", changedBy: "system" });
    expect(historyPayload[1]).toMatchObject({ studentProfileId: 2, status: "COMPLETE", changedBy: "system" });
  });

  it("ใช้ statusNote คนละข้อความกันระหว่างฝั่ง ACTIVE ปกติกับฝั่งที่เคยขยายเวลา", async () => {
    const service = new InternshipCompleteCronService();
    mockUpdateReturning
      .mockResolvedValueOnce([{ studentProfileId: 1, userId: "student-1" }])
      .mockResolvedValueOnce([]);

    await service.updateToComplete();

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      internshipStatus: "COMPLETE",
      statusNote: expect.stringContaining("3 วันทำการ"),
    });
  });
});
