import { describe, expect, it } from "bun:test";
import { UserService } from "../service";

// ---------------------------------------------------------------------------
// เทสฟังก์ชันคำนวณล้วนๆ ที่ไม่แตะ database (private method เรียกผ่าน
// (service as any)) — ใช้คำนวณวันสิ้นสุด/วันเริ่มต้นที่อนุญาต สำหรับ
// การขอขยายเวลาฝึกงาน (extendInternship) โดยข้ามวันเสาร์-อาทิตย์
//
// ใช้ constructor แบบ local (new Date(y, m, d)) แทน ISO string ("2025-06-16")
// เสมอ เพราะฟังก์ชันเป้าหมายเรียก .getDay()/.setDate() แบบ local time —
// ถ้าใช้ ISO string (parse เป็น UTC midnight) วันที่อาจเพี้ยนไป 1 วันได้
// ขึ้นอยู่กับ timezone ของเครื่องที่รันเทส
// ---------------------------------------------------------------------------

const service = new UserService() as any;

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("UserService.calculateEndDateExcludingWeekends", () => {
  it("เพิ่มวันทำการ 0 วัน -> คืนวันเดิม", () => {
    const start = new Date(2025, 5, 16); // จันทร์
    const result = service.calculateEndDateExcludingWeekends(start, 0);
    expect(ymd(result)).toBe("2025-06-16");
  });

  it("เพิ่มวันทำการ 1 วันจากวันศุกร์ -> ข้ามเสาร์-อาทิตย์ ไปวันจันทร์ถัดไป", () => {
    const start = new Date(2025, 5, 20); // ศุกร์
    const result = service.calculateEndDateExcludingWeekends(start, 1);
    expect(ymd(result)).toBe("2025-06-23"); // จันทร์
  });

  it("เพิ่มวันทำการ 5 วันจากวันจันทร์ -> ได้วันจันทร์ถัดไป (ข้ามสุดสัปดาห์ 1 รอบ)", () => {
    const start = new Date(2025, 5, 16); // จันทร์
    const result = service.calculateEndDateExcludingWeekends(start, 5);
    expect(ymd(result)).toBe("2025-06-23");
  });
});

describe("UserService.calculateAllowedStartDate", () => {
  it("นับถอยหลังจากวันทำการ (ศุกร์) 7 วันทำการ นับรวมวันนั้นด้วย", () => {
    const end = new Date(2025, 5, 20); // ศุกร์ (วันทำการ, นับเป็นวันที่ 1)
    const result = service.calculateAllowedStartDate(end, 7);
    // นับถอยหลัง 7 วันทำการจากศุกร์ 20 มิ.ย. (รวมวันนั้น) -> พฤหัส 12 มิ.ย.
    expect(ymd(result)).toBe("2025-06-12");
  });

  it("ไม่นับวันสิ้นสุดที่เป็นวันหยุด (เสาร์) เป็นวันทำการ", () => {
    const end = new Date(2025, 5, 21); // เสาร์ ไม่นับเป็นวันทำการ
    const result = service.calculateAllowedStartDate(end, 1);
    // ต้องถอยไปหาวันทำการแรกก่อนหน้า คือศุกร์ 20 มิ.ย.
    expect(ymd(result)).toBe("2025-06-20");
  });
});
