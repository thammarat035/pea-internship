import { describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทสแยกไฟล์ต่างหาก เพราะต้องทดสอบพฤติกรรม "ตอน import ครั้งแรก" ของ
// service.ts ที่อ่าน process.env.APP_URL แล้ว throw ทันทีถ้าไม่ได้ตั้งไว้
// (บรรทัด 12-16 ของ service.ts) - ไฟล์เทสหลัก (service.test.ts) ตั้งค่า
// APP_URL ไว้ตั้งแต่ต้นไฟล์เพื่อให้ import ผ่านได้ปกติ จึงทดสอบเคส "ไม่ได้ตั้ง"
// ในไฟล์นี้แยกต่างหาก (คนละ process ตาม scripts/test-all.ts)
// ---------------------------------------------------------------------------

mock.module("nodemailer", () => ({
  default: { createTransport: mock(() => ({ sendMail: mock() })) },
}));

describe("mail/service.ts module load guard", () => {
  it("throws ทันทีตอน import ครั้งแรกเมื่อไม่ได้ตั้งค่า APP_URL ไว้", async () => {
    delete process.env.APP_URL;

    await expect(import("../service")).rejects.toThrow(
      "APP_URL is not set in environment variables",
    );
  });
});
