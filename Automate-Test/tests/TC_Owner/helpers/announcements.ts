import { Page, expect } from '@playwright/test';

/**
 * ติ๊กเลือก radio/checkbox แบบ custom-styled (Tailwind) โดยหา <input> จริงที่อยู่ใกล้
 * ข้อความนั้นที่สุดก่อน (มักอยู่ใน <label> ที่ครอบข้อความ) แล้ว .check() ตรงๆ
 * ซึ่งเชื่อถือได้กว่าการคลิกที่ข้อความเฉยๆ (คลิกข้อความอาจไม่ toggle input จริงถ้า
 * ข้อความไม่ได้อยู่ใน label เดียวกับ input) ถ้าหา input ไม่เจอเลย fallback ไปคลิกข้อความแทน
 *
 * ใช้งาน:
 *   import { checkOptionByText } from '../helpers/announcements';
 *   await checkOptionByText(page, 'ไม่จำกัดจำนวน');
 */
export async function checkOptionByText(page: Page, text: string) {
  const label = page.locator('label', { hasText: text }).first();
  const input = label.locator('input[type="radio"], input[type="checkbox"]');

  if ((await input.count()) > 0) {
    // คลิกที่ label ทั้งก้อน (ไม่ใช่ input ตรงๆ) เพราะบาง component
    // ผูก event handler ไว้ที่ label ไม่ใช่ input ที่อยู่ข้างใน
    await label.click({ force: true });
    return;
  }

  // fallback: ไม่มี label ครอบ ลองคลิกข้อความตรงๆ
  await page.getByText(text, { exact: true }).click({ force: true });
}

/**
 * ลบประกาศรับสมัครออกจากตาราง โดยหาแถวจากชื่อตำแหน่งงาน แล้วกดไอคอนถังขยะ
 * (คอลัมน์ "การดำเนินการ") จากนั้นกดยืนยันใน popup
 *
 * ใช้ทำความสะอาดข้อมูลที่เทสสร้างไว้ใน database จริง หลังเทสจบ เพื่อไม่ให้
 * ข้อมูลทดสอบพอกพูนขึ้นเรื่อยๆ ทุกครั้งที่รัน (ดู deleteAnnouncementByName
 * ควบคู่กับการตั้งชื่อตำแหน่งงานแบบ unique ต่อการรันแต่ละครั้ง เช่น
 * `Tester ${Date.now()}` เพื่อให้ลบได้ตรงตัวเป๊ะๆ ไม่ไปโดนแถวอื่น)
 *
 * หมายเหตุ: ไอคอนถังขยะเป็น icon-only button ไม่มี accessible name ระบุไว้
 * จึงอ้างอิงจากตำแหน่ง "ปุ่มตัวสุดท้ายในแถว" แทน — ถ้าโครงสร้างหน้าเปลี่ยน
 * (เช่น มีปุ่มอื่นเพิ่มมาต่อท้าย) ต้องปรับ selector ตรงนี้ใหม่
 *
 * ใช้งาน:
 *   import { deleteAnnouncementByName } from '../helpers/announcements';
 *   await deleteAnnouncementByName(page, uniqueTitle);
 */
export async function deleteAnnouncementByName(page: Page, name: string) {
  const row = page.getByRole('row', { name: new RegExp(name, 'i') }).first();
  await expect(row).toBeVisible();

  // ไอคอนถังขยะ = ปุ่มตัวสุดท้ายในแถว (ดู, แก้ไข, ลบ ตามลำดับในภาพหน้าเว็บ)
  await row.getByRole('button').last().click();

  // popup ยืนยันการลบ (heading "ยืนยันการลบประกาศ") มีปุ่ม "ยกเลิก" / "ลบประกาศ"
  await expect(page.getByText('ยืนยันการลบประกาศ')).toBeVisible();
  await page.getByRole('button', { name: 'ลบประกาศ' }).click();

  // ตรวจสอบว่าแถวหายไปจากตารางจริง
  await expect(row).not.toBeVisible({ timeout: 10000 });
}