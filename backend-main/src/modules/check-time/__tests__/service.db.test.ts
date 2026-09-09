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
// ไฟล์นี้เทสเมธอดที่แตะ database/S3 ทั้งหมดของ CheckTimeService (ที่ service.test.ts
// ไม่ได้ครอบคลุม เพราะไฟล์นั้นเทสเฉพาะฟังก์ชันคำนวณล้วนๆ) โดย mock "@/db" และ
// "@/lib/s3" ทั้งโมดูล (pattern เดียวกับ admin-dashboard) แล้วจำลอง chain ของ
// drizzle (query.*.findFirst/findMany, insert().values().returning(),
// update().set().where(), select().from().innerJoin().where().orderBy())
// ด้วย mock function ธรรมดา ไม่ต่อ database จริง
//
// เวลา (new Date()) ที่ใช้ตัดสิน PRESENT/LATE และเปิด-ปิดรอบลงเวลา ถูกทำให้
// deterministic ด้วย setSystemTime() ของ bun:test (คล้าย fake timer) โดย freeze
// เวลาเป็น instant ที่แน่นอนแล้วปล่อยให้โค้ดจริงแปลงเป็นเวลาไทยเอง
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  studentProfiles: makeQueryMock(),
  applicationStatuses: makeQueryMock(),
  leaveRequests: makeQueryMock(),
  attendanceLogs: makeQueryMock(),
  checkTimes: makeQueryMock(),
  timeCorrectionRequests: makeQueryMock(),
  users: makeQueryMock(),
};

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockSelect = mock();

// object ที่ทำตัวเป็นทั้ง query-builder ต่อ chain ได้ (.from/.innerJoin/.where/.orderBy)
// และ awaitable (มี .then) ในตัวเอง เพื่อรองรับทั้งกรณี `await select().from().where()`
// (ไม่มี orderBy ต่อท้าย) และ `await select().from()...where().orderBy()`
function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  query: queryMocks,
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const mockS3Send = mock();
mock.module("@/lib/s3", () => ({
  s3Client: { send: mockS3Send },
  BUCKET_NAME: "test-bucket",
}));

const { CheckTimeService } = await import("../service");
const { NotFoundError, ForbiddenError, ConflictError } = await import(
  "@/common/exceptions"
);

function bkkIso(dateStr: string, time: string) {
  return new Date(`${dateStr}T${time}:00+07:00`).toISOString();
}

const OFFICE = { latitude: 13.75, longitude: 100.5 };
const ACTIVE_APP = { department: { office: OFFICE } };
const STUDENT = { id: 1, userId: "user-1" };

beforeEach(() => {
  for (const q of Object.values(queryMocks)) {
    q.findFirst.mockReset();
    q.findMany.mockReset();
  }
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockSelect.mockReset();
  mockS3Send.mockReset();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("CheckTimeService (database-backed methods)", () => {
  describe("in()", () => {
    it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
      const service = new CheckTimeService();
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined);

      expect(service.in("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("throws NotFoundError เมื่อไม่พบสำนักงานของแผนกที่กำลังฝึกงาน", async () => {
      const service = new CheckTimeService();
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        undefined,
      );

      expect(service.in("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("throws ConflictError เมื่อมีการลาที่อนุมัติแล้วในวันนี้", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce({ id: 1 });

      expect(service.in("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("throws ConflictError เมื่อบันทึกเวลาเข้างานของวันนี้ไปแล้ว", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 10,
        checkInId: 999,
      });

      expect(service.in("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("throws ConflictError เมื่อบันทึกเวลาก่อน 08:00 น.", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "07:59")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);

      expect(service.in("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("บันทึกเข้างานสำเร็จตรงเวลา (PRESENT) ในสถานที่ และสร้าง attendanceLog ใหม่", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);
      mockInsertReturning.mockResolvedValueOnce([{ id: 501 }]);

      const result = await service.in("user-1", "1.2.3.4", {
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
      });

      expect(result.status).toBe("PRESENT");
      expect(result.isOnsite).toBe(true);
      expect(result.message).toBe("บันทึกเวลาเข้างานสำเร็จ");
      // ไม่มี existingLog -> insert attendanceLogs ใหม่ (เรียก insert ครั้งที่ 2 ต่อจาก checkTimes)
      expect(mockInsertValues).toHaveBeenCalledTimes(2);
      expect(mockInsertValues.mock.calls[1][0]).toMatchObject({
        studentProfileId: STUDENT.id,
        workDate: "2025-06-16",
        checkInId: 501,
        lateMinutes: 0,
        dailyStatus: "PRESENT",
      });
    });

    it("บันทึกเข้างานหลัง 08:45 น. ให้สถานะ LATE พร้อมคำนวณจำนวนนาทีสายถูกต้อง", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "09:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);
      mockInsertReturning.mockResolvedValueOnce([{ id: 502 }]);

      const result = await service.in("user-1", "1.2.3.4", {
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
      });

      expect(result.status).toBe("LATE");
      expect(result.message).toBe("คุณมาสาย 30 นาที");
      expect(mockInsertValues.mock.calls[1][0]).toMatchObject({
        lateMinutes: 30,
        dailyStatus: "LATE",
      });
    });

    it("ไม่อนุญาตเช็คอินนอกสถานที่เมื่อไม่มีกำหนดการ offsite ของวันนี้", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      mockSelect.mockReturnValueOnce(makeChainable([]));

      await expect(
        service.in("user-1", "1.2.3.4", { latitude: 14.0, longitude: 101.0 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("อนุญาตเช็คอินนอกสถานที่เมื่อมีกำหนดการ offsite ของวันนี้", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      mockSelect.mockReturnValueOnce(
        makeChainable([{ offsite_tasks: { locationName: "บ้านลูกค้า" } }]),
      );
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);
      mockInsertReturning.mockResolvedValueOnce([{ id: 503 }]);

      const result = await service.in("user-1", "1.2.3.4", {
        latitude: 14.0,
        longitude: 101.0,
      });

      expect(result.isOnsite).toBe(false);
      expect(result.location).toContain("บ้านลูกค้า");
    });

    it("ไม่ระบุพิกัด -> isOnsite false, location เป็นค่า default และไม่ query ตาราง offsite task", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "08:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);
      mockInsertReturning.mockResolvedValueOnce([{ id: 504 }]);

      const result = await service.in("user-1", "1.2.3.4", {});

      expect(result.isOnsite).toBe(false);
      expect(result.location).toBe("ไม่สามารถระบุพิกัดได้");
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("มี attendanceLog ของวันนี้อยู่แล้วแต่ยังไม่ได้เช็คอิน -> update และรวม lateMinutes เดิม", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "09:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 77,
        checkInId: null,
        lateMinutes: 5,
      });
      mockInsertReturning.mockResolvedValueOnce([{ id: 505 }]);

      await service.in("user-1", "1.2.3.4", {
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
      });

      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
        checkInId: 505,
        lateMinutes: 35, // 5 (เดิม) + 30 (สายรอบนี้)
        dailyStatus: "LATE",
      });
    });
  });

  describe("out()", () => {
    it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
      const service = new CheckTimeService();
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined);

      expect(service.out("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("throws ConflictError เมื่อมีการลาที่อนุมัติแล้วในวันนี้", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "16:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce({ id: 1 });

      expect(service.out("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("throws ConflictError เมื่อยังไม่ได้เช็คอินในวันนี้", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "16:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);

      expect(service.out("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("throws ConflictError เมื่อเช็คเอาท์ของวันนี้ไปแล้ว", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "16:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 10,
        checkInId: 501,
        checkOutId: 900,
      });

      expect(service.out("user-1", "1.2.3.4", {})).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("เช็คเอาท์สำเร็จเต็มวัน (08:30-16:30) ในสถานที่ ได้ 7.00 ชั่วโมง และ isVerified=true", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "16:30")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 10,
        checkInId: 501,
        checkOutId: null,
        dailyStatus: "PRESENT",
      });
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.checkTimes.findFirst.mockResolvedValueOnce({
        time: bkkIso("2025-06-16", "08:30"),
      });
      mockInsertReturning.mockResolvedValueOnce([{ id: 900 }]);

      const result = await service.out("user-1", "1.2.3.4", {
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
      });

      expect(result.hoursWorked).toBe("7.00");
      expect(result.isOnsite).toBe(true);
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
        checkOutId: 900,
        actualHoursWorked: "7.00",
        isVerified: true,
      });
    });

    it("คำนวณชั่วโมงทำงานจริงและหักพักเที่ยงถูกต้องเมื่อเข้างานสาย (09:00-15:00 -> 5.00 ชม.)", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "15:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 10,
        checkInId: 501,
        checkOutId: null,
        dailyStatus: "LATE",
      });
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.checkTimes.findFirst.mockResolvedValueOnce({
        time: bkkIso("2025-06-16", "09:00"),
      });
      mockInsertReturning.mockResolvedValueOnce([{ id: 901 }]);

      const result = await service.out("user-1", "1.2.3.4", {
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
      });

      expect(result.hoursWorked).toBe("5.00");
    });

    it("ไม่อนุญาตเช็คเอาท์นอกสถานที่เมื่อไม่มีกำหนดการ offsite และอนุญาตเมื่อมีกำหนดการ", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "16:30")));

      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 10,
        checkInId: 501,
        checkOutId: null,
        dailyStatus: "PRESENT",
      });
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      mockSelect.mockReturnValueOnce(makeChainable([]));

      await expect(
        service.out("user-1", "1.2.3.4", {
          latitude: 14.0,
          longitude: 101.0,
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(STUDENT);
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 11,
        checkInId: 502,
        checkOutId: null,
        dailyStatus: "PRESENT",
      });
      queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(
        ACTIVE_APP,
      );
      queryMocks.checkTimes.findFirst.mockResolvedValueOnce({
        time: bkkIso("2025-06-16", "08:30"),
      });
      mockSelect.mockReturnValueOnce(
        makeChainable([{ offsite_tasks: { locationName: "บ้านลูกค้า" } }]),
      );
      mockInsertReturning.mockResolvedValueOnce([{ id: 902 }]);

      const result = await service.out("user-1", "1.2.3.4", {
        latitude: 14.0,
        longitude: 101.0,
      });

      expect(result.isOnsite).toBe(false);
      expect(result.location).toContain("บ้านลูกค้า");
    });
  });

  describe("history()", () => {
    it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
      const service = new CheckTimeService();
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.history("user-1", 2025, 6, 1, 10),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("สรุปจำนวนสถานะแต่ละแบบถูกต้อง รวมถึง derive MISSING_OUT ของวันที่ผ่านมาแล้ว", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({ id: 1 });
      queryMocks.attendanceLogs.findMany
        .mockResolvedValueOnce([
          { dailyStatus: "PRESENT", checkInId: 1, checkOutId: 2, workDate: "2025-06-01" },
          { dailyStatus: "LATE", checkInId: 3, checkOutId: 4, workDate: "2025-06-02" },
          { dailyStatus: "LEAVE", checkInId: null, checkOutId: null, workDate: "2025-06-03" },
          { dailyStatus: "ABSENT", checkInId: null, checkOutId: null, workDate: "2025-06-04" },
          // ลืมเช็คเอาท์เมื่อวานนี้ -> ต้องถูกนับเป็น MISSING_OUT ไม่ใช่ PRESENT
          { dailyStatus: "PRESENT", checkInId: 5, checkOutId: null, workDate: "2025-06-15" },
        ])
        .mockResolvedValueOnce([]);
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      const result = await service.history("user-1", 2025, 6, 1, 10);

      expect(result.summary).toEqual({
        present: 1,
        late: 1,
        leave: 1,
        absent: 1,
        missingOut: 1,
        total: 5,
      });
    });

    it("แนบสถานะคำขอแก้ไขเวลา (isEdited/correctionStatus) และข้อมูลการลาให้แต่ละ record", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({ id: 1 });
      queryMocks.attendanceLogs.findMany
        .mockResolvedValueOnce([
          { dailyStatus: "LEAVE", checkInId: null, checkOutId: null, workDate: "2025-06-10" },
        ])
        .mockResolvedValueOnce([
          {
            id: 20,
            workDate: "2025-06-10",
            dailyStatus: "LEAVE",
            checkInId: null,
            checkOutId: null,
            actualHoursWorked: null,
            checkIn: null,
            checkOut: null,
          },
        ]);
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          leaveDatetime: bkkIso("2025-06-10", "09:00"),
          leaveRequestType: "SICK",
          reason: "ไข้หวัด",
          file: "leaves/1.pdf",
        },
      ]);
      queryMocks.timeCorrectionRequests.findMany.mockResolvedValueOnce([
        { id: 99, attendanceLogId: 20, status: "PENDING" },
      ]);

      const result = await service.history("user-1", 2025, 6, 1, 10);

      const record = result.records[0];
      expect(record.isEdited).toBe(true);
      expect(record.correctionStatus).toBe("PENDING");
      expect(record.correctionId).toBe(99);
      expect(record.leaveType).toBe("ลาป่วย");
      expect(record.leaveReason).toBe("ไข้หวัด");
    });

    it("รวมวันลาติดกันเข้าด้วยกัน (group) และคำนวณ pagination จากจำนวน record หลังรวมกลุ่มแล้ว", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({ id: 1 });

      const leaveLog = (id: number, workDate: string) => ({
        id,
        workDate,
        dailyStatus: "LEAVE",
        checkInId: null,
        checkOutId: null,
        actualHoursWorked: null,
        checkIn: null,
        checkOut: null,
      });

      queryMocks.attendanceLogs.findMany
        .mockResolvedValueOnce([
          { dailyStatus: "LEAVE", checkInId: null, checkOutId: null, workDate: "2025-06-01" },
          { dailyStatus: "LEAVE", checkInId: null, checkOutId: null, workDate: "2025-06-02" },
        ])
        .mockResolvedValueOnce([
          leaveLog(1, "2025-06-01"),
          leaveLog(2, "2025-06-02"),
        ]);
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          leaveDatetime: bkkIso("2025-06-01", "09:00"),
          leaveRequestType: "SICK",
          reason: "ไข้หวัด",
          file: null,
        },
        {
          leaveDatetime: bkkIso("2025-06-02", "09:00"),
          leaveRequestType: "SICK",
          reason: "ไข้หวัด",
          file: null,
        },
      ]);
      queryMocks.timeCorrectionRequests.findMany.mockResolvedValueOnce([]);

      const result = await service.history("user-1", 2025, 6, 1, 10);

      expect(result.records).toHaveLength(1);
      expect(result.records[0].ids).toEqual([1, 2]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        totalPages: 1,
        totalRecords: 1,
      });
    });
  });

  describe("edit()", () => {
    it("throws ConflictError เมื่อ attendanceLogId ไม่ใช่ตัวเลข", async () => {
      const service = new CheckTimeService();

      expect(
        service.edit("user-1", {
          attendanceLogId: Number.NaN,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ConflictError เมื่อมีคำขอแก้ไขเวลาที่ยังไม่ถูกปฏิเสธค้างอยู่แล้ว", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "PENDING",
      });

      expect(
        service.edit("user-1", {
          attendanceLogId: 55,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ConflictError เมื่อผู้ใช้ไม่มีสังกัดแผนก", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: null, fname: "ก", lname: "ข" },
      });

      expect(
        service.edit("user-1", {
          attendanceLogId: 55,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws NotFoundError เมื่อไม่พบรายการลงเวลา หรือรายการนั้นไม่ใช่ของนักศึกษาคนนี้", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: 10, fname: "ก", lname: "ข" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 55,
        studentProfileId: 999, // คนละคน
      });

      expect(
        service.edit("user-1", {
          attendanceLogId: 55,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อสถานะปัจจุบันไม่อยู่ในเงื่อนไขที่แก้ไขได้", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: 10, fname: "ก", lname: "ข" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 55,
        studentProfileId: 1,
        checkInId: 1,
        checkOutId: 2, // ไม่ missing-out
        dailyStatus: "SOME_UNKNOWN_STATUS",
        workDate: "2025-06-10",
        checkIn: null,
        checkOut: null,
      });

      expect(
        service.edit("user-1", {
          attendanceLogId: 55,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ConflictError เมื่อมีคำขอแก้ไขค้างอยู่แล้วสำหรับ log นี้ (ตรวจซ้ำใน transaction)", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst
        .mockResolvedValueOnce(undefined) // existingRequest (นอก transaction)
        .mockResolvedValueOnce({ id: 2, status: "PENDING" }); // duplicateCheckInTx
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: 10, fname: "ก", lname: "ข" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 55,
        studentProfileId: 1,
        checkInId: 1,
        checkOutId: null,
        dailyStatus: "PRESENT",
        workDate: "2025-06-10",
        checkIn: null,
        checkOut: null,
      });

      expect(
        service.edit("user-1", {
          attendanceLogId: 55,
          checkInTime: "08:30",
          checkOutTime: "16:30",
          reason: "ลืมลงเวลา",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ส่งคำขอแก้ไขเวลาสำเร็จ และส่ง notification ให้ mentor/admin ทุกคนในแผนก", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: 10, fname: "สมชาย", lname: "ใจดี" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 55,
        studentProfileId: 1,
        checkInId: 1,
        checkOutId: null,
        dailyStatus: "PRESENT",
        workDate: "2025-06-10",
        checkIn: { time: bkkIso("2025-06-10", "08:30") },
        checkOut: null,
      });
      mockInsertReturning.mockResolvedValueOnce([{ id: 777 }]);
      mockSelect.mockReturnValueOnce(
        makeChainable([{ id: "mentor-1" }, { id: "admin-1" }]),
      );

      const result = await service.edit("user-1", {
        attendanceLogId: 55,
        checkInTime: "08:30",
        checkOutTime: "16:30",
        reason: "ลืมลงเวลา",
      });

      const expectedHours = (
        service as unknown as {
          calculateCorrectionHours: (a: string, b: string) => string;
        }
      ).calculateCorrectionHours("08:30", "16:30");

      expect(result.requestId).toBe(777);
      expect(result.hoursWorked).toBe(expectedHours);
      // insert ครั้งที่ 1 = timeCorrectionRequests, ครั้งที่ 2 = notifications (2 คน)
      expect(mockInsertValues).toHaveBeenCalledTimes(2);
      const notificationPayload = mockInsertValues.mock.calls[1][0] as Array<{
        userId: string;
        message: string;
      }>;
      expect(notificationPayload).toHaveLength(2);
      expect(notificationPayload[0].message).toContain("สมชาย ใจดี");
    });

    it("ไม่ส่ง notification เมื่อในแผนกไม่มี mentor/admin เลย", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: "user-1",
        user: { departmentId: 10, fname: "สมชาย", lname: "ใจดี" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({
        id: 55,
        studentProfileId: 1,
        checkInId: 1,
        checkOutId: null,
        dailyStatus: "PRESENT",
        workDate: "2025-06-10",
        checkIn: { time: bkkIso("2025-06-10", "08:30") },
        checkOut: null,
      });
      mockInsertReturning.mockResolvedValueOnce([{ id: 778 }]);
      mockSelect.mockReturnValueOnce(makeChainable([]));

      await service.edit("user-1", {
        attendanceLogId: 55,
        checkInTime: "08:30",
        checkOutTime: "16:30",
        reason: "ลืมลงเวลา",
      });

      expect(mockInsertValues).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCorrectionDetail()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอแก้ไขเวลา", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );

      expect(
        service.getCorrectionDetail("user-1", 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ForbiddenError เมื่อคำขอนี้ไม่ใช่ของผู้ใช้ที่ร้องขอ", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        studentProfile: { userId: "someone-else" },
        attendanceLog: {},
        originalCheckIn: null,
        originalCheckOut: null,
        requestedCheckIn: null,
        requestedCheckOut: null,
      });

      expect(
        service.getCorrectionDetail("user-1", 1),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("คืนรายละเอียดคำขอแก้ไขเวลาพร้อมชื่อไฟล์แนบที่ตัดมาจาก URL", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "PENDING",
        reason: "ลืมลงเวลา",
        approverNote: null,
        attachmentUrl: "time-corrections/user-1/1700000000-abcd.pdf",
        studentProfile: { userId: "user-1" },
        attendanceLog: { workDate: "2025-06-10", actualHoursWorked: null },
        originalCheckIn: null,
        originalCheckOut: null,
        requestedCheckIn: bkkIso("2025-06-10", "08:30"),
        requestedCheckOut: bkkIso("2025-06-10", "16:30"),
        calculatedHours: "7.00",
      });

      const result = await service.getCorrectionDetail("user-1", 1);

      expect(result.data.workDate).toBe("2025-06-10");
      expect(result.data.attachment.name).toBe(
        "1700000000-abcd.pdf",
      );
      expect(result.data.requested.hoursWorked).toBe("7.00");
    });
  });

  describe("getFile()", () => {
    it("คืน buffer และ contentType จากไฟล์ใน S3/MinIO", async () => {
      const service = new CheckTimeService();
      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(new Uint8Array([1, 2, 3])),
        },
        ContentType: "application/pdf",
      });

      const result = await service.getFile("time-corrections/abc.pdf");

      expect(result.contentType).toBe("application/pdf");
      expect(Array.from(result.buffer as Uint8Array)).toEqual([1, 2, 3]);
    });

    it("throws NotFoundError เมื่อดึงไฟล์จาก S3 ไม่สำเร็จ", async () => {
      const service = new CheckTimeService();
      mockS3Send.mockRejectedValueOnce(new Error("not found in bucket"));

      expect(service.getFile("missing.pdf")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("getMentorCorrections()", () => {
    it("throws ForbiddenError เมื่อผู้ใช้ไม่ใช่พี่เลี้ยง (ไม่มี staffProfiles)", async () => {
      const service = new CheckTimeService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "user-1",
        staffProfiles: null,
      });

      expect(
        service.getMentorCorrections("user-1", {
          page: 1,
          limit: 10,
          viewType: "MINE",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("คืน list ว่างเมื่อไม่มีนักศึกษา active คนไหนตรงเงื่อนไขเลย", async () => {
      const service = new CheckTimeService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([]);

      const result = await service.getMentorCorrections("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
      });

      expect(result).toEqual({
        data: [],
        meta: { page: 1, limit: 10, totalPages: 0, totalRecords: 0 },
      });
    });

    it("กรองตาม status และตัดคำขอซ้ำของ attendanceLog เดียวกัน (เก็บเฉพาะรายการล่าสุด)", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([
        { userId: "student-1", departmentId: 10 },
      ]);
      queryMocks.studentProfiles.findMany.mockResolvedValueOnce([
        { id: 1 },
      ]);

      const row = (overrides: Record<string, unknown>) => ({
        id: 0,
        createdAt: new Date(),
        originalCheckIn: null,
        originalCheckOut: null,
        requestedCheckIn: null,
        requestedCheckOut: null,
        calculatedHours: "7.00",
        reason: "r",
        attachmentUrl: null,
        status: "PENDING",
        workDate: "2025-06-01",
        dailyStatus: "PRESENT",
        checkInId: 1,
        checkOutId: 2,
        fname: "สมชาย",
        lname: "ใจดี",
        username: "somchai",
        image: null,
        approverNote: null,
        attendanceLogId: 1,
        ...overrides,
      });

      mockSelect.mockReturnValueOnce(
        makeChainable([
          // รายการล่าสุดของ log id 1 (REJECTED) ต้องถูกใช้แทนรายการเก่ากว่า (PENDING)
          row({ id: 10, attendanceLogId: 1, status: "REJECTED" }),
          row({ id: 9, attendanceLogId: 1, status: "PENDING" }),
          row({ id: 11, attendanceLogId: 2, status: "APPROVED" }),
        ]),
      );

      const result = await service.getMentorCorrections("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
        status: "APPROVED",
      });

      expect(result.meta.totalRecords).toBe(1);
      expect(result.data[0].id).toBe(11);
    });

    it("excludePending=true กรองคำขอที่สถานะ PENDING ออกจากรายการ", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([
        { userId: "student-1", departmentId: 10 },
      ]);
      queryMocks.studentProfiles.findMany.mockResolvedValueOnce([{ id: 1 }]);

      mockSelect.mockReturnValueOnce(
        makeChainable([
          {
            id: 1,
            createdAt: new Date(),
            originalCheckIn: null,
            originalCheckOut: null,
            requestedCheckIn: null,
            requestedCheckOut: null,
            calculatedHours: "7.00",
            reason: "r",
            attachmentUrl: null,
            status: "PENDING",
            workDate: "2025-06-01",
            dailyStatus: "PRESENT",
            checkInId: 1,
            checkOutId: 2,
            fname: "ก",
            lname: "ข",
            username: "u1",
            image: null,
            approverNote: null,
            attendanceLogId: 1,
          },
        ]),
      );

      const result = await service.getMentorCorrections("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
        excludePending: "true",
      });

      expect(result.meta.totalRecords).toBe(0);
    });

    it("derive attendanceStatus เป็น MISSING_OUT เมื่อวันเก่ามี checkIn แต่ไม่มี checkOut", async () => {
      const service = new CheckTimeService();
      setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([
        { userId: "student-1", departmentId: 10 },
      ]);
      queryMocks.studentProfiles.findMany.mockResolvedValueOnce([{ id: 1 }]);

      mockSelect.mockReturnValueOnce(
        makeChainable([
          {
            id: 1,
            createdAt: new Date(),
            originalCheckIn: null,
            originalCheckOut: null,
            requestedCheckIn: null,
            requestedCheckOut: null,
            calculatedHours: "7.00",
            reason: "r",
            attachmentUrl: null,
            status: "PENDING",
            workDate: "2025-06-01", // ผ่านมาแล้ว ไม่ใช่วันนี้
            dailyStatus: "PRESENT",
            checkInId: 1,
            checkOutId: null,
            fname: "ก",
            lname: "ข",
            username: "u1",
            image: null,
            approverNote: null,
            attendanceLogId: 1,
          },
        ]),
      );

      const result = await service.getMentorCorrections("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
      });

      expect(result.data[0].attendanceStatus).toBe("MISSING_OUT");
    });
  });

  describe("getMentorCorrectionAuditView()", () => {
    it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
      const service = new CheckTimeService();
      queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.getMentorCorrectionAuditView("mentor-1", 1),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError เมื่อไม่พบคำขอแก้ไขเวลาที่ระบุ", async () => {
      const service = new CheckTimeService();
      queryMocks.users.findFirst.mockResolvedValueOnce({ id: "mentor-1" });
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );

      expect(
        service.getMentorCorrectionAuditView("mentor-1", 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("สร้าง timeline ครบทุกคำขอของ attendanceLog เดียวกัน พร้อม resolve ชื่อผู้อนุมัติ", async () => {
      const service = new CheckTimeService();
      queryMocks.users.findFirst
        .mockResolvedValueOnce({ id: "mentor-1" }) // mentor
        .mockResolvedValueOnce({ fname: "หัวหน้า", lname: "แผนก" }); // approver ของ req แรก
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 5,
        status: "REJECTED",
        attendanceLogId: 20,
        studentProfile: { user: { fname: "สมชาย", lname: "ใจดี" } },
      });
      queryMocks.timeCorrectionRequests.findMany.mockResolvedValueOnce([
        {
          id: 5,
          status: "REJECTED",
          createdAt: new Date("2025-06-01T00:00:00Z"),
          updatedAt: new Date("2025-06-02T00:00:00Z"),
          reason: "ลืมลงเวลา",
          requestedCheckIn: bkkIso("2025-06-01", "08:30"),
          requestedCheckOut: bkkIso("2025-06-01", "16:30"),
          originalCheckIn: null,
          originalCheckOut: null,
          approvedBy: "mentor-2",
        },
        {
          id: 6,
          status: "PENDING",
          createdAt: new Date("2025-06-03T00:00:00Z"),
          updatedAt: null,
          reason: "ขอแก้ไขอีกครั้ง",
          requestedCheckIn: bkkIso("2025-06-03", "08:30"),
          requestedCheckOut: bkkIso("2025-06-03", "16:30"),
          originalCheckIn: null,
          originalCheckOut: null,
          approvedBy: null,
        },
      ]);

      const result = await service.getMentorCorrectionAuditView(
        "mentor-1",
        5,
      );

      // req แรก (REJECTED) ได้ 2 entry (SUBMITTED + REJECTED), req ที่สอง (PENDING) ได้แค่ SUBMITTED
      expect(result.data.timeline).toHaveLength(3);
      expect(result.data.timeline[1].by).toBe("หัวหน้า แผนก");
      expect(result.data.timeline[1].label).toBe("ปฏิเสธการแก้ไขเวลา");
    });
  });

  describe("approveCorrection()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอแก้ไขเวลา", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );

      expect(
        service.approveCorrection("mentor-1", 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อคำขอถูกดำเนินการไปแล้ว", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "APPROVED",
      });

      expect(
        service.approveCorrection("mentor-1", 1),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("อนุมัติสำเร็จและได้สถานะ PRESENT เมื่อเวลาที่ขอแก้ไขเข้างานตรงเวลา", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "PENDING",
        attendanceLogId: 55,
        calculatedHours: "7.00",
        requestedCheckIn: bkkIso("2025-06-16", "08:30"),
        requestedCheckOut: bkkIso("2025-06-16", "16:30"),
        studentProfile: { userId: "user-1" },
      });
      mockInsertReturning
        .mockResolvedValueOnce([{ id: 601 }])
        .mockResolvedValueOnce([{ id: 602 }]);

      const result = await service.approveCorrection("mentor-1", 1);

      expect(result.newStatus).toBe("PRESENT");
      expect(result.lateMinutes).toBe(0);
      // update ครั้งที่ 2 = attendanceLogs
      expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
        checkInId: 601,
        checkOutId: 602,
        actualHoursWorked: "7.00",
        dailyStatus: "PRESENT",
        isVerified: true,
      });
    });

    it("อนุมัติสำเร็จและได้สถานะ LATE พร้อมนาทีสายที่ถูกต้องเมื่อเวลาที่ขอแก้ไขเข้างานสาย", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 2,
        status: "PENDING",
        attendanceLogId: 56,
        calculatedHours: "6.50",
        requestedCheckIn: bkkIso("2025-06-16", "09:00"),
        requestedCheckOut: bkkIso("2025-06-16", "16:30"),
        studentProfile: { userId: "user-1" },
      });
      mockInsertReturning
        .mockResolvedValueOnce([{ id: 603 }])
        .mockResolvedValueOnce([{ id: 604 }]);

      const result = await service.approveCorrection("mentor-1", 2);

      expect(result.newStatus).toBe("LATE");
      expect(result.lateMinutes).toBe(30);
    });
  });

  describe("rejectCorrection()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอแก้ไขเวลา", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce(
        undefined,
      );

      expect(
        service.rejectCorrection("mentor-1", 1, "ไม่ถูกต้อง"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อคำขอถูกดำเนินการไปแล้ว", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "REJECTED",
      });

      expect(
        service.rejectCorrection("mentor-1", 1, "ไม่ถูกต้อง"),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ปฏิเสธคำขอสำเร็จ พร้อมบันทึกเหตุผลและผู้ปฏิเสธ", async () => {
      const service = new CheckTimeService();
      queryMocks.timeCorrectionRequests.findFirst.mockResolvedValueOnce({
        id: 1,
        status: "PENDING",
      });

      const result = await service.rejectCorrection(
        "mentor-1",
        1,
        "ข้อมูลไม่ถูกต้อง",
      );

      expect(result.success).toBe(true);
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
        status: "REJECTED",
        approvedBy: "mentor-1",
        approverNote: "ข้อมูลไม่ถูกต้อง",
      });
    });
  });
});
