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
// เทสเมธอดที่แตะ database/S3 ทั้งหมดของ LeaveService (ไม่ได้ครอบคลุมโดย
// service.test.ts ที่เทสเฉพาะฟังก์ชันคำนวณล้วนๆ) mock "@/db" และ "@/lib/s3"
// ทั้งโมดูล (pattern เดียวกับ check-time/__tests__/service.db.test.ts) แล้ว
// จำลอง chain ของ drizzle ด้วย mock function ธรรมดา ไม่ต่อ database จริง
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  studentProfiles: makeQueryMock(),
  leaveRequests: makeQueryMock(),
  attendanceLogs: makeQueryMock(),
  applicationStatuses: makeQueryMock(),
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

// object ที่ทำตัวเป็นทั้ง query-builder ต่อ chain ได้
// (.from/.innerJoin/.leftJoin/.where/.orderBy) และ awaitable (มี .then) ในตัวเอง
function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
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

const { LeaveService } = await import("../service");
const { ConflictError, ForbiddenError } = await import(
  "@/common/exceptions"
);
const { NotFoundError } = await import("elysia");

function bkkIso(dateStr: string, time: string) {
  return new Date(`${dateStr}T${time}:00+07:00`).toISOString();
}

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

describe("LeaveService (database-backed methods)", () => {
  describe("submitLeaveRequest()", () => {
    it("throws ForbiddenError เมื่อไม่พบผู้ใช้งานในระบบ", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([]));

      expect(
        service.submitLeaveRequest("user-1", {
          startDate: "2025-06-10",
          endDate: "2025-06-10",
          leaveType: "SICK",
          reason: "ไข้หวัด",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError เมื่อไม่พบโปรไฟล์นักศึกษา", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.submitLeaveRequest("user-1", {
          startDate: "2025-06-10",
          endDate: "2025-06-10",
          leaveType: "SICK",
          reason: "ไข้หวัด",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws Error เมื่อนักศึกษาไม่มีสังกัดแผนก", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        user: { fname: "ก", lname: "ข", departmentId: null },
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      expect(
        service.submitLeaveRequest("user-1", {
          startDate: "2025-06-10",
          endDate: "2025-06-10",
          leaveType: "SICK",
          reason: "ไข้หวัด",
        }),
      ).rejects.toThrow("นักศึกษาไม่มีสังกัดแผนก");
    });

    it("throws ConflictError เมื่อมีวันที่ขอลาซ้ำกับรายการเดิม (PENDING/APPROVED)", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        user: { fname: "ก", lname: "ข", departmentId: 10 },
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        { leaveDatetime: "2025-06-10T00:00:00" },
      ]);
      // owners select เรียกก่อน insert แต่หลัง existingLeaves check ใน transaction
      mockSelect.mockReturnValueOnce(makeChainable([]));

      expect(
        service.submitLeaveRequest("user-1", {
          startDate: "2025-06-10",
          endDate: "2025-06-10",
          leaveType: "SICK",
          reason: "ไข้หวัด",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ส่งคำขอลาสำเร็จหลายวัน สร้าง leaveRequests ครบทุกวัน และแจ้งเตือนพี่เลี้ยง/แอดมินในแผนก", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        user: { fname: "สมชาย", lname: "ใจดี", departmentId: 10 },
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);
      mockSelect.mockReturnValueOnce(
        makeChainable([{ id: "mentor-1" }, { id: "admin-1" }]),
      );

      const result = await service.submitLeaveRequest("user-1", {
        startDate: "2025-06-10",
        endDate: "2025-06-12",
        leaveType: "SICK",
        reason: "ไข้หวัด",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("3 วัน");
      // insert ครั้งที่ 1 = notifications (2 คน), ครั้งที่ 2 = leaveRequests (3 วัน)
      expect(mockInsertValues).toHaveBeenCalledTimes(2);
      const notificationPayload = mockInsertValues.mock.calls[0][0] as unknown[];
      expect(notificationPayload).toHaveLength(2);
      const leaveRequestPayload = mockInsertValues.mock.calls[1][0] as unknown[];
      expect(leaveRequestPayload).toHaveLength(3);
    });

    it("รองรับแนบไฟล์ใหม่ (อัปโหลดขึ้น S3) และแนบ URL เดิม (ส่งซ้ำ) โดยไม่ต้องอัปโหลดใหม่", async () => {
      const service = new LeaveService();

      // กรณี 1: แนบไฟล์ใหม่ -> ต้องอัปโหลดผ่าน s3Client.send
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        user: { fname: "ก", lname: "ข", departmentId: 10 },
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);
      mockSelect.mockReturnValueOnce(makeChainable([]));
      mockS3Send.mockResolvedValueOnce({});

      const file = new File(["dummy"], "cert.pdf", {
        type: "application/pdf",
      });
      await service.submitLeaveRequest("user-1", {
        startDate: "2025-06-10",
        endDate: "2025-06-10",
        leaveType: "SICK",
        reason: "ไข้หวัด",
        attachment: file,
      });

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const uploadedPayload = mockInsertValues.mock.calls[0][0] as Array<{
        file: string | null;
      }>;
      expect(uploadedPayload[0].file).toMatch(/^\/leave-documents\/user-1\//);

      // กรณี 2: ส่ง URL เดิมมา (resubmit) -> ไม่ต้องอัปโหลดซ้ำ
      mockS3Send.mockReset();
      mockInsertValues.mockClear();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 1,
        user: { fname: "ก", lname: "ข", departmentId: 10 },
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);
      mockSelect.mockReturnValueOnce(makeChainable([]));

      await service.submitLeaveRequest("user-1", {
        startDate: "2025-06-11",
        endDate: "2025-06-11",
        leaveType: "SICK",
        reason: "ไข้หวัด",
        attachment: "/leave-documents/user-1/existing.pdf",
      });

      expect(mockS3Send).not.toHaveBeenCalled();
      const reusedPayload = mockInsertValues.mock.calls[0][0] as Array<{
        file: string | null;
      }>;
      expect(reusedPayload[0].file).toBe("/leave-documents/user-1/existing.pdf");
    });
  });

  describe("bulkApproveLeaveRequests() / approveLeaveRequest()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอลาที่ระบุเลย", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        fname: "พี่เลี้ยง",
        lname: "ใจดี",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      expect(
        service.bulkApproveLeaveRequests("mentor-1", [1, 2]),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("อนุมัติสำเร็จ: สร้าง attendanceLog ใหม่เป็น LEAVE เมื่อยังไม่มี log ของวันนั้น และแจ้งเตือนนักศึกษา", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        fname: "พี่เลี้ยง",
        lname: "ใจดี",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 1,
          userId: "student-1",
          status: "PENDING",
          leaveDatetime: bkkIso("2025-06-10", "00:00"),
        },
      ]);
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 5,
        user: { fname: "สมชาย", lname: "ใจดี" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce(undefined);

      const result = await service.approveLeaveRequest("mentor-1", 1);

      expect(result.success).toBe(true);
      // update ครั้งที่ 1 = leaveRequests (APPROVED)
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
        status: "APPROVED",
        approvedBy: "mentor-1",
      });
      // insert ครั้งที่ 1 = attendanceLogs ใหม่ (ไม่มี log เดิม), ครั้งที่ 2 = notifications
      expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
        studentProfileId: 5,
        workDate: "2025-06-10",
        dailyStatus: "LEAVE",
        isVerified: true,
      });
      expect(mockInsertValues.mock.calls[1][0]).toMatchObject({
        userId: "student-1",
      });
    });

    it("อนุมัติสำเร็จ: update attendanceLog เดิมเป็น LEAVE เมื่อมี log ของวันนั้นอยู่แล้ว", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        fname: "พี่เลี้ยง",
        lname: "ใจดี",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 1,
          userId: "student-1",
          status: "PENDING",
          leaveDatetime: bkkIso("2025-06-10", "00:00"),
        },
      ]);
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
        id: 5,
        user: { fname: "สมชาย", lname: "ใจดี" },
      });
      queryMocks.attendanceLogs.findFirst.mockResolvedValueOnce({ id: 88 });

      await service.approveLeaveRequest("mentor-1", 1);

      // update ครั้งที่ 2 = attendanceLogs (log เดิม)
      expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({
        dailyStatus: "LEAVE",
        isVerified: true,
      });
      expect(mockInsertValues).toHaveBeenCalledTimes(1); // มีแค่ notifications insert
    });

    it("ข้ามรายการที่ไม่ใช่สถานะ PENDING และข้ามรายการที่หาโปรไฟล์นักศึกษาไม่เจอ", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        fname: "พี่เลี้ยง",
        lname: "ใจดี",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 1,
          userId: "student-1",
          status: "APPROVED", // ถูกดำเนินการไปแล้ว -> ข้าม
          leaveDatetime: bkkIso("2025-06-10", "00:00"),
        },
        {
          id: 2,
          userId: "student-2",
          status: "PENDING",
          leaveDatetime: bkkIso("2025-06-11", "00:00"),
        },
      ]);
      queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined); // หา student-2 ไม่เจอ -> ข้าม

      const result = await service.bulkApproveLeaveRequests("mentor-1", [
        1, 2,
      ]);

      expect(result.success).toBe(true);
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
    });
  });

  describe("getLeaveHistory()", () => {
    it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([]));

      expect(
        service.getLeaveHistory("user-1", { page: 1, limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("สรุปจำนวนวันลากิจ/ลาป่วยถูกต้อง", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany
        .mockResolvedValueOnce([
          { leaveRequestType: "SICK", status: "PENDING" },
          { leaveRequestType: "SICK", status: "APPROVED" },
          { leaveRequestType: "ABSENCE", status: "APPROVED" },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getLeaveHistory("user-1", {
        page: 1,
        limit: 10,
      });

      expect(result.summary).toEqual({ total: 3, absence: 1, sick: 2 });
    });

    it("ตัดรายการซ้ำที่วันที่/ช่วงเวลาเดียวกัน (เก็บรายการแรกตามลำดับที่ query คืนมา)", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 1,
            userId: "user-1",
            leaveDatetime: "2025-06-10T00:00:00",
            leavePeriod: "FULL_DAY",
            leaveRequestType: "SICK",
            status: "APPROVED",
            reason: "r",
            file: null,
            approverNote: null,
          },
          {
            // record เก่ากว่า (resubmit) วันเดียวกัน/ช่วงเดียวกัน -> ต้องถูกตัดออก
            id: 2,
            userId: "user-1",
            leaveDatetime: "2025-06-10T00:00:00",
            leavePeriod: "FULL_DAY",
            leaveRequestType: "SICK",
            status: "REJECTED",
            reason: "r",
            file: null,
            approverNote: null,
          },
        ]);

      const result = await service.getLeaveHistory("user-1", {
        page: 1,
        limit: 10,
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].ids).toEqual([1]);
      expect(result.pagination.totalRecords).toBe(1);
    });
  });

  describe("getMentorLeaveRequests()", () => {
    it("throws ForbiddenError เมื่อผู้ใช้ไม่ใช่พี่เลี้ยง", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "user-1",
        staffProfiles: null,
      });

      expect(
        service.getMentorLeaveRequests("user-1", {
          page: 1,
          limit: 10,
          viewType: "MINE",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("คืน list ว่างเมื่อไม่มีนักศึกษา active ตรงเงื่อนไข", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([]);

      const result = await service.getMentorLeaveRequests("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
      });

      expect(result).toEqual({
        data: [],
        meta: { page: 1, limit: 10, totalPages: 0, totalRecords: 0 },
      });
    });

    it("แสดงชื่อนักศึกษาพร้อม username ในวงเล็บ หรือข้อความ fallback เมื่อไม่มีชื่อเลย", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        departmentId: 10,
        staffProfiles: { id: 1 },
      });
      queryMocks.applicationStatuses.findMany.mockResolvedValueOnce([
        { userId: "student-1" },
        { userId: "student-2" },
      ]);
      mockSelect.mockReturnValueOnce(
        makeChainable([
          {
            id: 1,
            userId: "student-1",
            createdAt: new Date(),
            leaveDatetime: "2025-06-10T00:00:00",
            leaveRequestType: "SICK",
            status: "PENDING",
            reason: "r",
            file: null,
            fname: "สมชาย",
            lname: "ใจดี",
            username: "somchai",
            image: null,
          },
          {
            id: 2,
            userId: "student-2",
            createdAt: new Date(),
            leaveDatetime: "2025-06-11T00:00:00",
            leaveRequestType: "SICK",
            status: "PENDING",
            reason: "r",
            file: null,
            fname: "",
            lname: "",
            username: null,
            image: null,
          },
        ]),
      );

      const result = await service.getMentorLeaveRequests("mentor-1", {
        page: 1,
        limit: 10,
        viewType: "MINE",
      });

      const byId = (id: number) =>
        result.data.find((r: { ids: number[] }) => r.ids.includes(id))!;
      expect(byId(1).studentName).toBe("สมชาย ใจดี (somchai)");
      expect(byId(2).studentName).toBe("นักศึกษา (ไม่ระบุชื่อ)");
    });
  });

  describe("rejectLeaveRequest() / bulkRejectLeaveRequests()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอลาที่ระบุเลย", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      expect(
        service.rejectLeaveRequest("mentor-1", 1, "ไม่ถูกต้อง"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อไม่มีรายการไหนอยู่ในสถานะ PENDING เลย", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        { id: 1, status: "APPROVED", user_userId: { fname: "ก", lname: "ข" } },
      ]);

      expect(
        service.rejectLeaveRequest("mentor-1", 1, "ไม่ถูกต้อง"),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ปฏิเสธเฉพาะรายการที่ PENDING และแจ้งเตือนเฉพาะรายการที่ถูกปฏิเสธจริง", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
      queryMocks.users.findFirst.mockResolvedValueOnce({
        fname: "พี่เลี้ยง",
        lname: "ใจดี",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 1,
          userId: "student-1",
          status: "PENDING",
          leaveDatetime: bkkIso("2025-06-10", "00:00"),
          user_userId: { fname: "สมชาย", lname: "ใจดี" },
        },
        {
          id: 2,
          userId: "student-1",
          status: "REJECTED", // ถูกดำเนินการไปแล้ว -> ไม่ถูกแตะซ้ำ
          leaveDatetime: bkkIso("2025-06-11", "00:00"),
          user_userId: { fname: "สมชาย", lname: "ใจดี" },
        },
      ]);

      const result = await service.bulkRejectLeaveRequests(
        "mentor-1",
        [1, 2],
        "ข้อมูลไม่ครบ",
      );

      expect(result.success).toBe(true);
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
        status: "REJECTED",
        approverNote: "ข้อมูลไม่ครบ",
      });
      const notificationPayload = mockInsertValues.mock.calls[0][0] as unknown[];
      expect(notificationPayload).toHaveLength(1); // แจ้งเตือนเฉพาะ id 1 ที่เพิ่งถูกปฏิเสธ
    });
  });

  describe("deleteLeaveRequest() / bulkDeleteLeaveRequests()", () => {
    it("throws NotFoundError เมื่อไม่พบใบลาที่ระบุเลย", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      expect(
        service.deleteLeaveRequest("user-1", 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อบางรายการถูกดำเนินการไปแล้ว (ไม่ใช่ PENDING)", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        { id: 1, status: "APPROVED" },
      ]);

      expect(
        service.deleteLeaveRequest("user-1", 1),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ยกเลิก (soft delete) สำเร็จเมื่อทุกรายการเป็น PENDING", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        { id: 1, status: "PENDING" },
        { id: 2, status: "PENDING" },
      ]);

      const result = await service.bulkDeleteLeaveRequests("user-1", [1, 2]);

      expect(result.success).toBe(true);
      expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("deletedAt");
    });
  });

  describe("resubmitLeaveRequests()", () => {
    it("throws NotFoundError เมื่อไม่พบคำขอลาที่ระบุเลย", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([]);

      expect(
        service.resubmitLeaveRequests("user-1", [1]),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError เมื่อมีรายการที่ไม่ใช่สถานะ REJECTED", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        { id: 1, status: "PENDING" },
      ]);

      expect(
        service.resubmitLeaveRequests("user-1", [1]),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("ส่งคำขอซ้ำสำเร็จ โดยสร้างรายการใหม่สถานะ PENDING คัดลอกข้อมูลเดิม", async () => {
      const service = new LeaveService();
      mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 1,
          status: "REJECTED",
          leaveRequestType: "SICK",
          leavePeriod: "FULL_DAY",
          userId: "user-1",
          leaveDatetime: "2025-06-10T00:00:00",
          reason: "ไข้หวัด",
          file: null,
        },
      ]);

      const result = await service.resubmitLeaveRequests("user-1", [1]);

      expect(result.success).toBe(true);
      expect(mockInsertValues.mock.calls[0][0]).toEqual([
        {
          leaveRequestType: "SICK",
          leavePeriod: "FULL_DAY",
          userId: "user-1",
          leaveDatetime: "2025-06-10T00:00:00",
          reason: "ไข้หวัด",
          file: null,
          status: "PENDING",
        },
      ]);
    });
  });

  describe("getMentorAuditView()", () => {
    it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.getMentorAuditView("mentor-1", 1),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError เมื่อไม่พบใบลา", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({ id: "mentor-1" });
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.getMentorAuditView("mentor-1", 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("สร้าง timeline ครบทุกคำขอของวัน/ช่วงเวลาเดียวกัน พร้อม resolve ชื่อผู้อนุมัติ", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst
        .mockResolvedValueOnce({ id: "mentor-1" }) // mentor
        .mockResolvedValueOnce({ fname: "สมชาย", lname: "ใจดี" }) // userRecord (เจ้าของใบลา)
        .mockResolvedValueOnce({ fname: "หัวหน้า", lname: "แผนก" }); // approver
      queryMocks.leaveRequests.findFirst.mockResolvedValueOnce({
        id: 5,
        userId: "student-1",
        leaveDatetime: "2025-06-10T00:00:00",
        leavePeriod: "FULL_DAY",
        status: "REJECTED",
      });
      queryMocks.leaveRequests.findMany.mockResolvedValueOnce([
        {
          id: 5,
          status: "REJECTED",
          createdAt: new Date("2025-06-01T00:00:00Z"),
          leaveDatetime: "2025-06-10T00:00:00",
          reason: "ลืมแนบไฟล์",
          approvedAt: new Date("2025-06-02T00:00:00Z"),
          approverNote: "ข้อมูลไม่ครบ",
          approvedBy: "mentor-2",
        },
      ]);

      const result = await service.getMentorAuditView("mentor-1", 5);

      expect(result.data.timeline).toHaveLength(2);
      expect(result.data.timeline[1].by).toBe("หัวหน้า แผนก");
      expect(result.data.timeline[1].label).toBe("ปฏิเสธการลา");
    });
  });

  describe("getMentorAuditList()", () => {
    it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

      expect(
        service.getMentorAuditList("mentor-1", { page: 1, limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("ไม่ระบุ status -> แสดงเฉพาะรายการที่ APPROVED หรือ REJECTED เท่านั้น (ไม่รวม PENDING)", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        roleId: 2,
        departmentId: 10,
      });
      mockSelect.mockReturnValueOnce(
        makeChainable([
          { userId: "s1", leaveDate: "2025-06-01T00:00:00", leavePeriod: "FULL_DAY", status: "APPROVED" },
          { userId: "s2", leaveDate: "2025-06-02T00:00:00", leavePeriod: "FULL_DAY", status: "PENDING" },
          { userId: "s3", leaveDate: "2025-06-03T00:00:00", leavePeriod: "FULL_DAY", status: "REJECTED" },
        ]),
      );

      const result = await service.getMentorAuditList("mentor-1", {
        page: 1,
        limit: 10,
      });

      expect(result.meta.total).toBe(2);
      expect(
        result.data.every((r: { status: string }) => r.status !== "PENDING"),
      ).toBe(true);
    });

    it("กรองตาม status ที่ระบุ และตัดรายการซ้ำ (user+วัน+ช่วงเวลาเดียวกัน)", async () => {
      const service = new LeaveService();
      queryMocks.users.findFirst.mockResolvedValueOnce({
        id: "mentor-1",
        roleId: 1, // admin เห็นทุกแผนก
        departmentId: null,
      });
      mockSelect.mockReturnValueOnce(
        makeChainable([
          { userId: "s1", leaveDate: "2025-06-01T00:00:00", leavePeriod: "FULL_DAY", status: "PENDING" },
          { userId: "s1", leaveDate: "2025-06-01T00:00:00", leavePeriod: "FULL_DAY", status: "PENDING" }, // ซ้ำ -> ตัดออก
        ]),
      );

      const result = await service.getMentorAuditList("mentor-1", {
        page: 1,
        limit: 10,
        status: "PENDING",
      });

      expect(result.meta.total).toBe(1);
    });
  });
});
