import { describe, expect, it } from "bun:test";
import { CheckTimeService } from "../service";

// ---------------------------------------------------------------------------
// ไฟล์นี้เทสเฉพาะ "ฟังก์ชันคำนวณล้วนๆ" ที่ไม่แตะ database เลย จึงไม่ต้อง
// mock อะไรทั้งนั้น (ไม่มี mock.module เลยในไฟล์นี้) - เขียนง่ายและเร็วที่สุด
// เพราะ input เดียวกัน ต้องได้ output เดียวกันเสมอ ไม่มีตัวแปรภายนอกมาเกี่ยวข้อง
//
// getDistanceInMeters / calculateCorrectionHours เป็น private method ในคลาส
// เราจึงต้องเรียกผ่าน (service as any) เพื่อข้ามการเช็คของ TypeScript ตอน
// compile (runtime จริงเรียกได้ปกติ private เป็นแค่ป้ายเตือนตอนเขียนโค้ด)
// ---------------------------------------------------------------------------

const service = new CheckTimeService() as any;

describe("CheckTimeService (pure calculation methods)", () => {
  describe("getDistanceInMeters", () => {
    it("คืนค่า 0 เมื่อพิกัดสองจุดเป็นจุดเดียวกัน", () => {
      const distance = service.getDistanceInMeters(
        13.7563,
        100.5018,
        13.7563,
        100.5018,
      );
      expect(distance).toBeCloseTo(0, 1);
    });

    it("คำนวณระยะทางระหว่าง 2 พิกัดที่ห่างกันจริงได้ใกล้เคียงค่าจริง", () => {
      // จุด A: อนุสาวรีย์ชัยสมรภูมิ, จุด B: ห่างไปทางเหนือประมาณ 0.001 องศา (~111 เมตร)
      const distance = service.getDistanceInMeters(
        13.7650,
        100.5380,
        13.7660,
        100.5380,
      );
      // 0.001 องศา ละติจูด ≈ 111 เมตร (ยอมรับค่าคลาดเคลื่อนได้ในหลัก ±5 เมตร)
      expect(distance).toBeGreaterThan(105);
      expect(distance).toBeLessThan(115);
    });

    it("คำนวณระยะทางแบบสมมาตร (สลับจุด A กับ B ต้องได้ระยะทางเท่ากัน)", () => {
      const distanceAB = service.getDistanceInMeters(
        13.75,
        100.5,
        13.76,
        100.51,
      );
      const distanceBA = service.getDistanceInMeters(
        13.76,
        100.51,
        13.75,
        100.5,
      );
      expect(distanceAB).toBeCloseTo(distanceBA, 5);
    });
  });

  describe("calculateCorrectionHours", () => {
    it("ให้ 7 ชั่วโมงเต็ม เมื่อเข้างานในช่วงผ่อนผัน (ไม่เกิน 08:45) และออกงานหลัง 16:00", () => {
      const hours = service.calculateCorrectionHours("08:30", "16:30");
      expect(hours).toBe("7.00");
    });

    it("ให้ 7 ชั่วโมงเต็ม แม้เข้างานเร็วมาก ถ้าออกงานหลัง 16:00 (grace period shortcut)", () => {
      const hours = service.calculateCorrectionHours("07:00", "20:00");
      expect(hours).toBe("7.00");
    });

    it("คำนวณชั่วโมงจริงและหักเวลาพักเที่ยง (12:00-13:00) เมื่อไม่เข้าเงื่อนไข grace period", () => {
      // เข้า 09:00 (ไม่เข้าเงื่อนไข grace เพราะ inHour=9 ไม่ <8 และไม่ใช่ 8:xx)
      // 09:00-16:30 = 7.5 ชม. หักพักเที่ยง 1 ชม. = 6.5 ชม.
      const hours = service.calculateCorrectionHours("09:00", "16:30");
      expect(hours).toBe("6.50");
    });

    it("ไม่นับเวลาพักเที่ยงซ้ำ เมื่อเข้า-ออกงานอยู่แค่ช่วงบ่ายเดียว (ไม่คาบเกี่ยวมื้อเที่ยง)", () => {
      // เข้า 14:00 ออก 15:00 (ทั้งคู่อยู่หลังเที่ยงแล้ว ไม่มีช่วงเช้าให้หัก)
      const hours = service.calculateCorrectionHours("14:00", "15:00");
      expect(hours).toBe("1.00");
    });

    it("จำกัดชั่วโมงสูงสุดไม่เกิน 7 ชั่วโมง แม้คำนวณได้มากกว่านั้น", () => {
      // เข้า 09:00 (ไม่เข้า grace) ออก 22:00 -> คำนวณได้ 12 ชม. ต้องถูกจำกัดเหลือ 7
      const hours = service.calculateCorrectionHours("09:00", "22:00");
      expect(hours).toBe("7.00");
    });
  });

  describe("groupAttendanceRecords", () => {
    const baseRecord = {
      checkInTime: "08:30",
      checkOutTime: "16:30",
      location: "ในสถานที่",
      workingHours: "7.00 ชั่วโมง",
      isEdited: false,
      correctionStatus: null,
      correctionId: null,
      attachmentUrl: null,
    };

    it("คืนค่า array ว่างเมื่อไม่มีข้อมูลเลย", () => {
      const result = service.groupAttendanceRecords([]);
      expect(result).toEqual([]);
    });

    it("ไม่จัดกลุ่มรายการที่ไม่ใช่สถานะ LEAVE (แต่ละวันแยกกันเป็นรายการเดี่ยว)", () => {
      const records = [
        {
          ...baseRecord,
          id: 1,
          workDate: "2025-01-01",
          displayStatus: "PRESENT",
          leaveType: null,
          leaveReason: null,
        },
        {
          ...baseRecord,
          id: 2,
          workDate: "2025-01-02",
          displayStatus: "LATE",
          leaveType: null,
          leaveReason: null,
        },
      ];

      const result = service.groupAttendanceRecords(records);

      expect(result).toHaveLength(2);
      expect(result[0].ids).toEqual([2]); // เรียงจากวันล่าสุดไปเก่าสุด
      expect(result[1].ids).toEqual([1]);
    });

    it("รวมวันลาที่ติดกันและมี leaveType/leaveReason เดียวกันเข้าเป็นกลุ่มเดียว", () => {
      const records = [
        {
          ...baseRecord,
          id: 1,
          workDate: "2025-01-01",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
        {
          ...baseRecord,
          id: 2,
          workDate: "2025-01-02",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
        {
          ...baseRecord,
          id: 3,
          workDate: "2025-01-03",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
      ];

      const result = service.groupAttendanceRecords(records);

      expect(result).toHaveLength(1);
      expect(result[0].ids).toEqual([1, 2, 3]);
      expect(result[0].startDate).toBe("2025-01-01");
      expect(result[0].endDate).toBe("2025-01-03");
    });

    it("ไม่รวมวันลาที่ 'ไม่ติดกัน' เข้าด้วยกัน (เว้นช่วง ต้องแยกเป็นคนละกลุ่ม)", () => {
      const records = [
        {
          ...baseRecord,
          id: 1,
          workDate: "2025-01-01",
          displayStatus: "LEAVE",
          leaveType: "ลากิจ",
          leaveReason: "ธุระส่วนตัว",
        },
        {
          ...baseRecord,
          id: 2,
          workDate: "2025-01-05", // ห่างจากวันแรก 4 วัน ไม่ติดกัน
          displayStatus: "LEAVE",
          leaveType: "ลากิจ",
          leaveReason: "ธุระส่วนตัว",
        },
      ];

      const result = service.groupAttendanceRecords(records);

      expect(result).toHaveLength(2);
    });

    it("ไม่รวมวันลาที่ติดกันแต่คนละประเภท/เหตุผลเข้าด้วยกัน (leaveType ต่างกัน)", () => {
      const records = [
        {
          ...baseRecord,
          id: 1,
          workDate: "2025-01-01",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
        {
          ...baseRecord,
          id: 2,
          workDate: "2025-01-02",
          displayStatus: "LEAVE",
          leaveType: "ลากิจ", // คนละประเภทกับวันก่อนหน้า แม้จะติดกัน
          leaveReason: "ธุระส่วนตัว",
        },
      ];

      const result = service.groupAttendanceRecords(records);

      expect(result).toHaveLength(2);
    });

    it("จัดการข้อมูลผสม (มีทั้งวันลาติดกันและวันสถานะอื่นคั่นกลาง) ได้ถูกต้อง", () => {
      const records = [
        {
          ...baseRecord,
          id: 1,
          workDate: "2025-01-01",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
        {
          ...baseRecord,
          id: 2,
          workDate: "2025-01-02",
          displayStatus: "PRESENT", // มาทำงานคั่นกลาง ตัดกลุ่มลาให้ขาดตอน
          leaveType: null,
          leaveReason: null,
        },
        {
          ...baseRecord,
          id: 3,
          workDate: "2025-01-03",
          displayStatus: "LEAVE",
          leaveType: "ลาป่วย",
          leaveReason: "ไข้หวัด",
        },
      ];

      const result = service.groupAttendanceRecords(records);

      // ต้องได้ 3 กลุ่มแยกกัน (ลา, มาทำงาน, ลา) ไม่ใช่รวมลาทั้งสองช่วงเข้าด้วยกัน
      expect(result).toHaveLength(3);
    });
  });
});