import { test, expect } from '@playwright/test';
import { login, openProfileMenu, clickLogoutMenuItem } from '../helpers/login';

test.describe('ออกจากระบบ', () => {
  // MT-TC-098 (Functional)
  // Scenario: ตรวจสอบความถูกต้องในการเคลียร์เซสชันและการเปลี่ยนหน้าเมื่อกดปุ่มออกจากระบบ
  // Precondition: ผู้ใช้ล็อกอินอยู่ในระบบเรียบร้อยแล้ว
  test('MT-TC-098 ออกจากระบบสำเร็จ เคลียร์เซสชันและกลับหน้าหลัก', async ({ page }) => {
    await login(page, '700001', 'PEA@@123456');

    // scope nav ไว้ตัวแปรเดียว ใช้ตรวจสอบผลลัพธ์ก่อน/หลัง logout ในไฟล์นี้
    const nav = page.locator('nav');

    // 1. คลิกไอคอนรูปคน (โปรไฟล์) เพื่อเปิด dropdown ก่อน
    // (ชื่อ-อีเมลจะแสดงก็ต่อเมื่อ dropdown ถูกเปิดแล้วเท่านั้น)
    await openProfileMenu(page);

    // ตรวจสอบว่า dropdown เปิดขึ้นมาถูกต้อง แสดงชื่อ-อีเมลของผู้ใช้ปัจจุบัน
    await expect(nav.getByText('ปรวรรธน์ จรรยาเพศ')).toBeVisible();
    await expect(nav.getByText('700001.tes@pea.co.th')).toBeVisible();

    // 2. คลิกปุ่มตัวอักษรสีแดง "ออกจากระบบ"
    await clickLogoutMenuItem(page);

    // แถบเมนูขวาบนต้องเปลี่ยนเป็นปุ่ม "เข้าสู่ระบบผู้สมัคร" และ "เข้าสู่ระบบพนักงาน PEA"
    // แทนที่โปรไฟล์ผู้ใช้เดิม
    await expect(
      nav.getByRole('button', { name: 'เข้าสู่ระบบพนักงาน PEA' })
    ).toBeVisible();
    await expect(nav.getByRole('link', { name: 'เข้าสู่ระบบผู้สมัคร' })).toBeVisible();

    // ต้องไม่เห็นชื่อผู้ใช้คนเดิมอีกต่อไปใน "แถบเมนูด้านบน" (session ถูกเคลียร์จริง)
    // scope เฉพาะ nav — ไม่เช็คทั้งหน้า เพราะชื่อคนเดียวกันอาจไปปรากฏซ้ำ
    // ในเนื้อหาส่วนอื่น (เช่น การ์ดรายละเอียดตำแหน่งงานที่ระบุชื่อผู้ประกาศ)
    await expect(nav.getByText('ปรวรรธน์ จรรยาเพศ')).not.toBeVisible();
  });
});