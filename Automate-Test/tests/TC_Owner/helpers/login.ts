import { Page, expect } from '@playwright/test';

export const HOME_URL = 'http://localhost:2700';
export const DASHBOARD_URL_REGEX = /localhost:2700\/owner\/announcements/;
export const SSO_URL_REGEX = /sso2\.pea\.co\.th/;

/**
 * ปุ่ม Sign in บนหน้า Keycloak (sso2.pea.co.th) — id="kc-login" ของ Keycloak มาตรฐาน
 * ใช้ไม่ได้กับ theme ของเว็บนี้ จึงลองหลาย selector แบบ fallback
 */
export function keycloakLoginButton(page: Page) {
  return page
    .locator('#kc-login')
    .or(page.locator('button[type="submit"]'))
    .or(page.getByRole('button', { name: /เข้าสู่ระบบ|Sign In/i }))
    .first();
}

/**
 * เปิดหน้าแรกของเว็บ PEA (Home)
 */
export async function gotoHome(page: Page) {
  await page.goto(HOME_URL);
}

/**
 * คลิกปุ่ม "เข้าสู่ระบบพนักงาน PEA" มุมขวาบน แล้วตรวจสอบว่าเข้าหน้า Sign In ถูกต้อง
 * (สำคัญ: ต้องคลิกผ่านปุ่มจริง ห้าม goto ตรงไปที่ URL ของ sso2 เพราะ state/cookie
 *  ของ OAuth flow จะไม่ตรงกัน ทำให้เจอ error "please_restart_the_process")
 */
export async function clickEmployeeLogin(page: Page) {
  await page.getByRole('button', { name: 'เข้าสู่ระบบพนักงาน PEA' }).click();
  await expect(page).toHaveURL(SSO_URL_REGEX);
}

/**
 * กรอก Username / Password ลงในฟอร์ม Keycloak (ไม่กด submit)
 */
export async function fillCredentials(
  page: Page,
  username: string,
  password: string
) {
  if (username) await page.locator('#username').fill(username);
  if (password) await page.locator('#password').fill(password);
}

/**
 * กดปุ่ม Sign in บนหน้า Keycloak
 */
export async function submitLoginForm(page: Page) {
  await keycloakLoginButton(page).click();
}

/**
 * ฟังก์ชัน login แบบครบวงจร สำหรับ "เคส success" เท่านั้น
 * เปิดหน้าแรก -> คลิกเข้าสู่ระบบพนักงาน -> กรอก username/password -> submit
 * -> ตรวจสอบว่าเข้าสู่หน้า Dashboard สำเร็จ
 *
 * ใช้งานใน test case อื่น:
 *   import { login } from '../helpers/login';
 *   await login(page, '700001', 'PEA@@123456');
 */
export async function login(page: Page, username: string, password: string) {
  await gotoHome(page);
  await clickEmployeeLogin(page);
  await fillCredentials(page, username, password);
  await submitLoginForm(page);

  await expect(page).toHaveURL(DASHBOARD_URL_REGEX, { timeout: 15000 });
}

/**
 * ฟังก์ชันสำหรับ "เคส negative" (login ผิด / ไม่กรอกข้อมูล)
 * ทำทุกอย่างเหมือน login() แต่ "ไม่ assert" ผลลัพธ์ว่าต้องสำเร็จ
 * เพื่อให้ test case ไปเช็ค error message / validation เองได้
 *
 * ใช้งาน:
 *   await attemptLogin(page, '755414', 'wrong1555');
 *   await expect(page.getByText('Invalid username or password.')).toBeVisible();
 *
 *   // หรือกรณีไม่กรอกอะไรเลย ส่ง username/password เป็น '' ได้ (จะไม่ fill field นั้น)
 *   await attemptLogin(page, '', '');
 */
export async function attemptLogin(
  page: Page,
  username: string,
  password: string
) {
  await gotoHome(page);
  await clickEmployeeLogin(page);
  await fillCredentials(page, username, password);
  await submitLoginForm(page);
}

/**
 * คลิกไอคอนโปรไฟล์มุมขวาบนแถบเมนู เพื่อเปิด dropdown
 * (ไอคอนนี้ไม่มี accessible name/text ระบุไว้ เป็น icon-only button
 *  จึงเลือกจากตำแหน่ง: ปุ่มตัวสุดท้ายในแถบ navigation แทน)
 *
 * แยกออกมาจาก logout() เพื่อให้ test case ที่อยากตรวจสอบเนื้อหาใน dropdown
 * (เช่น ชื่อ-อีเมลผู้ใช้) ก่อนกด logout สามารถเปิดเมนูเองได้โดยไม่ต้องคลิกซ้ำสองรอบ
 * (คลิกไอคอนซ้ำ = ปิด dropdown แทนที่จะเปิด)
 */
export async function openProfileMenu(page: Page) {
  const nav = page.locator('nav');
  await nav.getByRole('button').last().click();
}

/**
 * คลิก "ออกจากระบบ" ใน dropdown ที่เปิดอยู่แล้ว แล้วตรวจสอบว่ากลับมาหน้าหลัก
 * ต้องเปิด dropdown ไว้ก่อน (ผ่าน openProfileMenu หรือ logout()) ถึงเรียกใช้ได้
 */
export async function clickLogoutMenuItem(page: Page) {
  const nav = page.locator('nav');
  await nav.getByText('ออกจากระบบ', { exact: true }).click();

  // ตรวจสอบว่าระบบทำลายเซสชันและพากลับมาหน้าหลัก (Landing Page) ทันที
  await expect(page).toHaveURL(`${HOME_URL}/`);
}

/**
 * ออกจากระบบแบบครบวงจร (เปิดเมนู + กดออกจากระบบ) — ใช้กับเทสที่ไม่ต้องเช็คอะไรใน
 * dropdown ก่อน ถ้าต้องเช็คชื่อ/อีเมลก่อน logout ให้ใช้ openProfileMenu()
 * แล้วตามด้วย clickLogoutMenuItem() แยกกันแทน
 *
 * ใช้งาน:
 *   await login(page, '700001', 'PEA@@123456');
 *   await logout(page);
 *   await expect(page).toHaveURL('http://localhost:2700/');
 */
export async function logout(page: Page) {
  await openProfileMenu(page);
  await clickLogoutMenuItem(page);
}