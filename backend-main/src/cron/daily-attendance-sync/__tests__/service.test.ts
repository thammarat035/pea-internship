import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส cron job: sync สถานะเข้างานรายวัน - เว้นวันหยุดสุดสัปดาห์, สร้าง
// attendanceLog เป็น ABSENT ให้นักศึกษา ACTIVE ที่ยังไม่ลงเวลาเลยวันนี้ (และ
// อยู่ในช่วงวันที่ฝึกงานจริง) และ mark MISSING_OUT ให้คนที่เช็คอินแล้วแต่ลืม
// เช็คเอาท์
//
// หมายเหตุ: โค้ดจริงเช็ควันหยุดสุดสัปดาห์ด้วย now.getDay() (timezone ของ
// เครื่องที่รันจริง) แต่คำนวณ todayStr ด้วย Asia/Bangkok formatter แยกกัน -
// เพื่อไม่ให้เทสเปราะบางกับ timezone ของเครื่องที่รัน จึงใช้ Date แบบ local
// constructor (new Date(y,m,d)) ควบคุม dayOfWeek ตรงๆ และใช้ช่วงวันที่ของ
// appInfo ที่กว้างมาก/แคบมากพอจะไม่ชนขอบ timezone
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  studentProfiles: makeQueryMock(),
  attendanceLogs: makeQueryMock(),
};

const mockInsertValues = mock((_v?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock(() => Promise.resolve([] as Array<{ id: number }>));
const mockUpdateWhere = mock((_w?: unknown) => ({ returning: mockUpdateReturning }));
const mockUpdateSet = mock((_s?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const dbMock = {
  query: queryMocks,
  insert: mockInsert,
  update: mockUpdate,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};
mock.module("@/db", () => ({ db: dbMock }));

const { CheckTimeService } = await import("../service");

function studentWithApp(
  id: number,
  overrides: { startDate?: string; endDate?: string } = {},
) {
  return {
    id,
    user: {
      applicationStatuses: [
        {
          applicationInformations: [
            {
              startDate: overrides.startDate ?? null,
              endDate: overrides.endDate ?? null,
            },
          ],
        },
      ],
    },
  };
}

beforeEach(() => {
  queryMocks.studentProfiles.findFirst.mockReset();
  queryMocks.studentProfiles.findMany.mockReset();
  queryMocks.attendanceLogs.findFirst.mockReset();
  queryMocks.attendanceLogs.findMany.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateReturning.mockResolvedValue([]);
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("CheckTimeService.syncDailyAttendance (cron)", () => {
  it("ข้ามการทำงานทั้งหมดในวันเสาร์-อาทิตย์ ไม่ query อะไรเลย", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 21)); // เสาร์

    const result = await service.syncDailyAttendance();

    expect(result).toEqual({ message: "Weekend, skipping..." });
    expect(queryMocks.studentProfiles.findMany).not.toHaveBeenCalled();
  });

  it("ไม่มีนักศึกษา active เลย -> คืนผลลัพธ์ว่างทั้งหมด", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 16)); // จันทร์
    queryMocks.studentProfiles.findMany.mockResolvedValueOnce([]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await service.syncDailyAttendance();

    expect(result.success).toBe(true);
    expect(result.markedAbsentCount).toBe(0);
  });

  it("ข้ามนักศึกษาที่วันนี้อยู่นอกช่วงวันที่ฝึกงาน (ยังไม่เริ่ม/จบไปแล้ว) ไม่สร้าง ABSENT ให้", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 16));
    queryMocks.studentProfiles.findMany.mockResolvedValueOnce([
      studentWithApp(1, { startDate: "2030-01-01", endDate: "2030-06-01" }), // ยังไม่เริ่ม
    ]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await service.syncDailyAttendance();

    expect(result.markedAbsentCount).toBe(0);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(queryMocks.attendanceLogs.findFirst).not.toHaveBeenCalled();
  });

  it("สร้าง attendanceLog เป็น ABSENT ให้นักศึกษาที่อยู่ในช่วงฝึกงานแต่ยังไม่มี log ของวันนี้เลย", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 16));
    queryMocks.studentProfiles.findMany.mockResolvedValueOnce([
      studentWithApp(1, { startDate: "2020-01-01", endDate: "2030-01-01" }),
    ]);
    queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await service.syncDailyAttendance();

    expect(result.markedAbsentCount).toBe(1);
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      studentProfileId: 1,
      dailyStatus: "ABSENT",
    });
  });

  it("ไม่สร้างซ้ำเมื่อมี attendanceLog ของวันนี้อยู่แล้ว (ไม่ว่าสถานะจะเป็นอะไรก็ตาม)", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 16));
    queryMocks.studentProfiles.findMany.mockResolvedValueOnce([
      studentWithApp(1, { startDate: "2020-01-01", endDate: "2030-01-01" }),
    ]);
    queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({ id: 99 });
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await service.syncDailyAttendance();

    expect(result.markedAbsentCount).toBe(0);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("นับจำนวนแถวที่ถูก mark เป็น MISSING_OUT จากผลลัพธ์ของ bulk update", async () => {
    const service = new CheckTimeService();
    setSystemTime(new Date(2025, 5, 16));
    queryMocks.studentProfiles.findMany.mockResolvedValueOnce([]);
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    const result = await service.syncDailyAttendance();

    expect(result.markedMissingOutCount).toBe(2);
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ dailyStatus: "MISSING_OUT" });
  });
});
