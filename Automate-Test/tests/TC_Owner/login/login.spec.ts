import { test, expect } from '@playwright/test';
import { login, attemptLogin } from './../helpers/login';

// MT-TC-001 (Functional)
// Scenario: เข้าสู่ระบบพนักงาน PEA ผ่านหน้าจอล็อกอินหลักสำเร็จ
// Precondition: พี่เลี้ยงมีบัญชีในระบบแล้ว
test('MT-TC-001 login สำเร็จด้วย Username และ Password ที่ถูกต้อง', async ({ page }) => {
  await login(page, '700001', 'PEA@@123456');

  // ตรวจสอบว่าระบบตรวจสอบสิทธิ์สำเร็จ และนำผู้ใช้เข้าสู่หน้า Dashboard หลัก
  await expect(page.getByText('ประกาศที่รับสมัครอยู่')).toBeVisible();
});

// MT-TC-002 (Functional)
// Scenario: เข้าสู่ระบบพนักงาน PEA ผ่านหน้าจอล็อกอินไม่สำเร็จ
//           (กรอก Username หรือ รหัสผ่านไม่ถูกต้อง)
// Precondition: พี่เลี้ยงมีบัญชีในระบบแล้ว
test('MT-TC-002 login ไม่สำเร็จเมื่อกรอก Username หรือ Password ผิด', async ({ page }) => {
  await attemptLogin(page, '755414', 'wrong1555');

  // ตรวจสอบข้อความเตือนใต้ช่อง Username หรือ Email
  await expect(page.getByText('Invalid username or password.')).toBeVisible();

  // ต้องยังคงอยู่หน้า login เดิม ไม่ถูกนำเข้าสู่ระบบ
  await expect(page).toHaveURL(/sso2\.pea\.co\.th/);
});

// MT-TC-003 (Functional)
// Scenario: เข้าสู่ระบบพนักงาน PEA ผ่านหน้าจอล็อกอินไม่สำเร็จ (ไม่กรอกข้อมูลใดๆ)
// Precondition: พี่เลี้ยงมีบัญชีในระบบแล้ว
test('MT-TC-003 login ไม่สำเร็จเมื่อไม่กรอก Username และ Password', async ({ page }) => {
  await attemptLogin(page, '', '');

  // ระบบแสดงข้อความเตือน HTML5 required-field validation ใต้ช่อง Username หรือ Email
  const validationMessage = await page
    .locator('#username')
    .evaluate((el: HTMLInputElement) => el.validationMessage);
  expect(validationMessage).toBe('Please fill out this field.');

  // ฟอร์มต้องไม่ถูกส่ง ผู้ใช้ยังคงอยู่หน้า login เดิม
  await expect(page).toHaveURL(/sso2\.pea\.co\.th/);
});