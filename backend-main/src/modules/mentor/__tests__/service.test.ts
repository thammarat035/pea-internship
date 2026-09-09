import { describe, expect, it } from "bun:test";
import { MentorService } from "../service";

// ---------------------------------------------------------------------------
// เทสฟังก์ชันคำนวณล้วนๆ ที่ไม่แตะ database (private method เรียกผ่าน
// (service as any)) ตาม pattern เดียวกับโมดูลอื่น
// ---------------------------------------------------------------------------

const service = new MentorService() as any;

describe("MentorService.countWorkingDays", () => {
  it("นับเป็น 1 วัน เมื่อ start และ end เป็นวันเดียวกันและเป็นวันธรรมดา (จันทร์)", () => {
    // 2025-06-16 เป็นวันจันทร์
    const days = service.countWorkingDays(
      new Date("2025-06-16"),
      new Date("2025-06-16"),
    );
    expect(days).toBe(1);
  });

  it("นับเป็น 0 วัน เมื่อ start และ end เป็นวันเดียวกันและเป็นวันเสาร์", () => {
    // 2025-06-14 เป็นวันเสาร์
    const days = service.countWorkingDays(
      new Date("2025-06-14"),
      new Date("2025-06-14"),
    );
    expect(days).toBe(0);
  });

  it("นับได้ 5 วันทำการ สำหรับสัปดาห์ปกติ (จ.-ศ.)", () => {
    const days = service.countWorkingDays(
      new Date("2025-06-16"), // จันทร์
      new Date("2025-06-20"), // ศุกร์
    );
    expect(days).toBe(5);
  });

  it("นับได้ 5 วันทำการ แม้ช่วงวันที่คร่อมเสาร์-อาทิตย์ด้วย (ไม่นับวันหยุด)", () => {
    const days = service.countWorkingDays(
      new Date("2025-06-16"), // จันทร์
      new Date("2025-06-22"), // อาทิตย์ถัดไป
    );
    expect(days).toBe(5);
  });

  it("คืนค่า 0 เมื่อ startDate อยู่หลัง endDate", () => {
    const days = service.countWorkingDays(
      new Date("2025-06-20"),
      new Date("2025-06-16"),
    );
    expect(days).toBe(0);
  });
});
