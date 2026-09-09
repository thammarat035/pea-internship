import { describe, expect, it } from "bun:test";
import { LeaveService } from "../service";

// ---------------------------------------------------------------------------
// ไฟล์นี้เทสเฉพาะ "ฟังก์ชันล้วนๆ" ที่ไม่แตะ database (private method เรียกผ่าน
// (service as any)) ตาม pattern เดียวกับ check-time/service.test.ts —
// input เดียวกันต้องได้ output เดียวกันเสมอ ไม่ต้อง mock อะไรเลย
// ---------------------------------------------------------------------------

const service = new LeaveService() as any;

describe("LeaveService (pure calculation methods)", () => {
  describe("getDatesInRange", () => {
    it("คืนวันเดียวเมื่อ startDate เท่ากับ endDate", () => {
      const dates = service.getDatesInRange("2025-06-10", "2025-06-10");
      expect(dates).toEqual(["2025-06-10"]);
    });

    it("คืนทุกวันตั้งแต่ startDate ถึง endDate แบบต่อเนื่อง (inclusive)", () => {
      const dates = service.getDatesInRange("2025-06-10", "2025-06-13");
      expect(dates).toEqual([
        "2025-06-10",
        "2025-06-11",
        "2025-06-12",
        "2025-06-13",
      ]);
    });

    it("ข้ามเดือนได้ถูกต้อง (30 มิ.ย. -> 1 ก.ค.)", () => {
      const dates = service.getDatesInRange("2025-06-29", "2025-07-02");
      expect(dates).toEqual([
        "2025-06-29",
        "2025-06-30",
        "2025-07-01",
        "2025-07-02",
      ]);
    });
  });

  describe("groupLeaveRecords", () => {
    const baseRecord = {
      userId: "user-1",
      leaveType: "SICK",
      status: "PENDING",
      reason: "ไข้หวัด",
      attachmentUrl: null,
      approverNote: null,
    };

    it("คืนค่า array ว่างเมื่อไม่มีข้อมูลเลย", () => {
      expect(service.groupLeaveRecords([])).toEqual([]);
    });

    it("รวมวันลาที่ติดกันและมีคุณสมบัติเหมือนกันทุกอย่างเข้าเป็นกลุ่มเดียว", () => {
      const records = [
        { ...baseRecord, id: 1, leaveDate: "2025-06-01" },
        { ...baseRecord, id: 2, leaveDate: "2025-06-02" },
        { ...baseRecord, id: 3, leaveDate: "2025-06-03" },
      ];

      const result = service.groupLeaveRecords(records);

      expect(result).toHaveLength(1);
      expect(result[0].ids).toEqual([1, 2, 3]);
      expect(result[0].startDate).toBe("2025-06-01");
      expect(result[0].endDate).toBe("2025-06-03");
    });

    it("ไม่รวมวันลาที่ไม่ติดกัน (เว้นช่วง)", () => {
      const records = [
        { ...baseRecord, id: 1, leaveDate: "2025-06-01" },
        { ...baseRecord, id: 2, leaveDate: "2025-06-05" },
      ];

      const result = service.groupLeaveRecords(records);

      expect(result).toHaveLength(2);
    });

    it("ไม่รวมวันลาที่ติดกันแต่คนละสถานะ (เช่น วันหนึ่ง PENDING อีกวัน APPROVED)", () => {
      const records = [
        { ...baseRecord, id: 1, leaveDate: "2025-06-01", status: "PENDING" },
        { ...baseRecord, id: 2, leaveDate: "2025-06-02", status: "APPROVED" },
      ];

      const result = service.groupLeaveRecords(records);

      expect(result).toHaveLength(2);
    });

    it("ไม่รวมวันลาที่ติดกันแต่เป็นคนละ user กัน", () => {
      const records = [
        { ...baseRecord, id: 1, leaveDate: "2025-06-01", userId: "user-1" },
        { ...baseRecord, id: 2, leaveDate: "2025-06-02", userId: "user-2" },
      ];

      const result = service.groupLeaveRecords(records);

      expect(result).toHaveLength(2);
    });

    it("เรียงผลลัพธ์จาก startDate ล่าสุดไปเก่าสุด", () => {
      const records = [
        { ...baseRecord, id: 1, leaveDate: "2025-06-01" },
        { ...baseRecord, id: 2, leaveDate: "2025-06-10" },
      ];

      const result = service.groupLeaveRecords(records);

      expect(result[0].startDate).toBe("2025-06-10");
      expect(result[1].startDate).toBe("2025-06-01");
    });
  });
});
