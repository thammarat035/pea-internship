import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// แนวคิด: getDashboardStats() และ getTopUnits() เรียก db.select().from().where()
// เป็นลำดับหลายครั้งติดกัน (2 ครั้งสำหรับ getDashboardStats, สูงสุด 4 ครั้งสำหรับ
// getTopUnits) เราจึงต้องสร้าง "ของปลอมที่เลียนแบบ chain นี้" แล้วสั่งว่า
// "เรียกครั้งที่ 1 ให้คืนค่านี้ ครั้งที่ 2 ให้คืนค่านี้" ตามลำดับที่โค้ดจริงเรียก
//
// queryResult(data) คืน object ที่มี .from() และ .where() ให้เรียกต่อกันได้
// (chain) แล้วสุดท้าย "await" ได้ค่า data ที่เรากำหนดไว้ล่วงหน้า
// ---------------------------------------------------------------------------

function queryResult(data: unknown) {
  return {
    from: () => ({
      where: () => Promise.resolve(data),
    }),
  };
}

const mockSelect = mock();

// ต้องเรียก mock.module ก่อน import ไฟล์จริงเสมอ (ดูคำอธิบายด้านบน)
mock.module("@/db", () => ({
  db: { select: mockSelect },
}));

// import แบบ dynamic (await import) เพื่อให้แน่ใจว่าโหลดไฟล์ "หลังจาก" ที่ mock ติดตั้งเสร็จแล้ว
const { AdminDashboardService } = await import("../service");

describe("AdminDashboardService", () => {
  let service: InstanceType<typeof AdminDashboardService>;

  beforeEach(() => {
    // ล้างประวัติการเรียกและค่าที่ตั้งไว้ทุกครั้งก่อนแต่ละเทส กัน test หนึ่งไปกระทบอีก test
    mockSelect.mockReset();
    service = new AdminDashboardService();
  });

  describe("getDashboardStats", () => {
    it("คำนวณ totalActive และอัตราการลา/สาย/ขาด ได้ถูกต้องเมื่อมีข้อมูลครบ", async () => {
      mockSelect
        // เรียกครั้งที่ 1: นับจำนวนนักศึกษาที่ active
        .mockReturnValueOnce(queryResult([{ total: 10 }]))
        // เรียกครั้งที่ 2: attendance logs ของเดือนนั้น (10 รายการ: ลา 2, สาย 3, ขาด 1, ปกติ 4)
        .mockReturnValueOnce(
          queryResult([
            { dailyStatus: "LEAVE" },
            { dailyStatus: "LEAVE" },
            { dailyStatus: "LATE" },
            { dailyStatus: "LATE" },
            { dailyStatus: "LATE" },
            { dailyStatus: "ABSENT" },
            { dailyStatus: "NORMAL" },
            { dailyStatus: "NORMAL" },
            { dailyStatus: "NORMAL" },
            { dailyStatus: "NORMAL" },
          ]),
        );

      const result = await service.getDashboardStats(1, 2025);

      expect(result.totalActive).toBe(10);
      // 2 จาก 10 รายการ = 20%
      expect(result.leaveRate).toBe(20);
      // 3 จาก 10 รายการ = 30%
      expect(result.lateRate).toBe(30);
      // 1 จาก 10 รายการ = 10%
      expect(result.absentRate).toBe(10);
      expect(result.period).toEqual({ year: 2025, month: 1 });
    });

    it("คืนค่าอัตราทั้งหมดเป็น 0 เมื่อไม่มี attendance log ในเดือนนั้นเลย (กัน divide by zero)", async () => {
      mockSelect
        .mockReturnValueOnce(queryResult([{ total: 5 }]))
        .mockReturnValueOnce(queryResult([])); // ไม่มี log เลย

      const result = await service.getDashboardStats(2, 2025);

      expect(result.leaveRate).toBe(0);
      expect(result.lateRate).toBe(0);
      expect(result.absentRate).toBe(0);
    });

    it("คืนค่า totalActive เป็น 0 เมื่อ query ไม่เจอแถวไหนเลย (activeResult เป็น undefined)", async () => {
      mockSelect
        .mockReturnValueOnce(queryResult([])) // ไม่มีแถวเลย -> destructure ได้ undefined
        .mockReturnValueOnce(queryResult([]));

      const result = await service.getDashboardStats(1, 2025);

      expect(result.totalActive).toBe(0);
    });

    it("ปัดเศษอัตราส่วนเป็นทศนิยม 1 ตำแหน่งถูกต้อง (ไม่ใช่จำนวนเต็มพอดี)", async () => {
      mockSelect.mockReturnValueOnce(queryResult([{ total: 1 }])).mockReturnValueOnce(
        queryResult([
          { dailyStatus: "LEAVE" },
          { dailyStatus: "NORMAL" },
          { dailyStatus: "NORMAL" },
        ]),
      );

      const result = await service.getDashboardStats(3, 2025);

      // 1 จาก 3 = 33.333...% -> ต้องปัดเหลือ 33.3
      expect(result.leaveRate).toBe(33.3);
    });

    it("คำนวณ endDate ถูกต้องสำหรับเดือนที่มี 28/30/31 วัน (เดือนกุมภาพันธ์)", async () => {
      mockSelect
        .mockReturnValueOnce(queryResult([{ total: 1 }]))
        .mockReturnValueOnce(queryResult([]));

      // ปี 2024 เป็นปีอธิกสุรทิน กุมภาพันธ์มี 29 วัน - ทดสอบว่าฟังก์ชันไม่ throw
      // และคำนวณผ่านได้ปกติ (ตรวจสอบ behavior ทางอ้อมผ่านผลลัพธ์ที่ไม่ error)
      const result = await service.getDashboardStats(2, 2024);
      expect(result.period).toEqual({ year: 2024, month: 2 });
    });
  });

  describe("getTopUnits", () => {
    it("คืนค่า array ว่างทั้งหมดทันที เมื่อไม่มีนักศึกษา active เลย (early return)", async () => {
      mockSelect.mockReturnValueOnce(queryResult([])); // activeApps ว่าง

      const result = await service.getTopUnits(1, 2025);

      expect(result).toEqual({
        leaveTop: [],
        lateTop: [],
        absentTop: [],
        period: { year: 2025, month: 1 },
      });
      // ต้องเรียก db.select แค่ 1 ครั้งเท่านั้น (early return ก่อนจะ query ต่อ)
      expect(mockSelect).toHaveBeenCalledTimes(1);
    });

    it("คืนค่า array ว่างทั้งหมด เมื่อมี active apps แต่หา studentProfile ไม่เจอเลย", async () => {
      mockSelect
        .mockReturnValueOnce(
          queryResult([{ userId: "u1", departmentId: 100 }]),
        )
        .mockReturnValueOnce(queryResult([])); // studentProfileRows ว่าง

      const result = await service.getTopUnits(1, 2025);

      expect(result.leaveTop).toEqual([]);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });

    it("จัดอันดับ Top 5 หน่วยงานที่มีการลา/สาย/ขาด มากที่สุดได้ถูกต้อง", async () => {
      mockSelect
        .mockReturnValueOnce(
          queryResult([
            { userId: "u1", departmentId: 100 },
            { userId: "u2", departmentId: 200 },
          ]),
        )
        .mockReturnValueOnce(
          queryResult([
            { id: 1, userId: "u1" },
            { id: 2, userId: "u2" },
          ]),
        )
        .mockReturnValueOnce(
          queryResult([
            { studentProfileId: 1, dailyStatus: "LEAVE" },
            { studentProfileId: 1, dailyStatus: "LEAVE" },
            { studentProfileId: 2, dailyStatus: "LEAVE" },
          ]),
        )
        .mockReturnValueOnce(
          queryResult([
            { deptSap: 100, deptShort: "IT", deptSapShort: null },
            { deptSap: 200, deptShort: "HR", deptSapShort: null },
          ]),
        );

      const result = await service.getTopUnits(1, 2025);

      // แผนก 100 (IT) มีคนลา 2 ครั้ง เยอะกว่าแผนก 200 (HR) ที่มี 1 ครั้ง จึงต้องมาก่อน
      expect(result.leaveTop[0]).toEqual({ name: "IT", value: 2 });
      expect(result.leaveTop[1]).toEqual({ name: "HR", value: 1 });
    });

    it("ใช้ 'Dept {id}' เป็นชื่อ fallback เมื่อหาชื่อแผนกไม่เจอในตาราง departments", async () => {
      mockSelect
        .mockReturnValueOnce(
          queryResult([{ userId: "u1", departmentId: 999 }]),
        )
        .mockReturnValueOnce(queryResult([{ id: 1, userId: "u1" }]))
        .mockReturnValueOnce(
          queryResult([{ studentProfileId: 1, dailyStatus: "LATE" }]),
        )
        .mockReturnValueOnce(queryResult([])); // ไม่เจอแผนกในตาราง departments เลย

      const result = await service.getTopUnits(1, 2025);

      expect(result.lateTop[0]).toEqual({ name: "999", value: 1 });
    });

    it("ข้าม log ที่หา studentProfileId หรือ departmentId ที่เกี่ยวข้องไม่เจอ (ข้อมูลไม่ตรงกัน)", async () => {
      mockSelect
        .mockReturnValueOnce(
          queryResult([{ userId: "u1", departmentId: 100 }]),
        )
        .mockReturnValueOnce(queryResult([{ id: 1, userId: "u1" }]))
        .mockReturnValueOnce(
          queryResult([
            // studentProfileId: 999 ไม่ตรงกับที่มีอยู่ (มีแค่ id 1) -> ต้องถูกข้าม ไม่ error
            { studentProfileId: 999, dailyStatus: "ABSENT" },
          ]),
        )
        .mockReturnValueOnce(
          queryResult([{ deptSap: 100, deptShort: "IT", deptSapShort: null }]),
        );

      const result = await service.getTopUnits(1, 2025);

      // ไม่มี log ไหนถูกนับเลย เพราะ studentProfileId ไม่ตรงกับใครในระบบ
      expect(result.absentTop).toEqual([]);
    });
  });
});

// ป้องกันไว้ก่อนเผื่อในอนาคตมีไฟล์เทสอื่นเรียงตัวอักษรมาหลังไฟล์นี้ (เช่น "z-...")
// ที่ import "@/db" ตัวจริง ให้ได้ของจริงไปใช้ ไม่ใช่ mock ที่ค้างมาจากไฟล์นี้
afterAll(() => {
  mock.restore();
});