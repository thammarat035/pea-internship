import { test, expect } from '@playwright/test';
import { login } from '../helpers/login';
import { checkOptionByText, deleteAnnouncementByName } from '../helpers/announcements';

test.describe('จัดการประกาศรับสมัคร - สร้างประกาศ', () => {
  test.beforeEach(async ({ page }) => {
    // ดักจับ error ที่เกิดขึ้นในหน้าเว็บ (console.error และ uncaught exception)
    // เพื่อช่วย debug กรณี submit แล้วไม่มีอะไรเกิดขึ้นแบบเงียบๆ
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER CONSOLE ERROR] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[BROWSER PAGE ERROR] ${err.message}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        console.log(`[HTTP ${res.status()}] ${res.url()}`);
      }
    });

    // Login เป็นพี่เลี้ยงก่อนทุก test (precondition: พี่เลี้ยงมีบัญชีในระบบแล้ว)
    await login(page, '700001', 'PEA@@123456');

    // เข้าหน้าสร้างประกาศโดยตรง
    await page.goto('http://localhost:2700/owner/announcements/create');
    await expect(page).toHaveURL(/localhost:2700\/owner\/announcements\/create/);
  });

  // MT-TC-004 (Functional)
  // Scenario: สร้างประกาศรับสมัครฝึกงานสำเร็จ เมื่อกรอกข้อมูลครบถ้วนและถูกต้อง
  test('MT-TC-004 สร้างประกาศรับสมัครฝึกงานสำเร็จ เมื่อกรอกข้อมูลครบถ้วนและถูกต้อง', async ({
    page,
  }) => {
    // ตั้งชื่อตำแหน่งงานให้ไม่ซ้ำกันทุกครั้งที่รัน (ผูกกับ timestamp)
    // เพื่อให้ตอนลบทำความสะอาดท้ายเทส รู้แน่ชัดว่าลบ "อันที่เทสนี้สร้าง" เท่านั้น
    // ไม่ไปโดนแถว Tester อันอื่นที่อาจค้างอยู่ในระบบจากการรันครั้งก่อนๆ
    const positionName = `Tester ${Date.now()}`;

    // === ข้อมูลพื้นฐาน ===
    // 1. กรอกชื่อตำแหน่งงาน
    await page.getByPlaceholder('ชื่อตำแหน่งงาน').fill(positionName);

    // 2. ฟิลด์ "หน่วยงาน" ต้องแสดงค่าเริ่มต้นอัตโนมัติ แก้ไขไม่ได้
    await expect(
      page.locator('input[value="กองออกแบบและพัฒนาระบบดิจิทัล 1"]')
    ).toBeVisible({ timeout: 7000 });

    // 3. กรอกสถานที่ปฏิบัติงาน
    await page
      .getByPlaceholder('สถานที่ปฏิบัติงาน')
      .fill('การไฟฟ้าสำนักงานใหญ่ กรุงเทพฯ อาคาร 4 ชั้น 7');

    // 4. เลือก "จำนวนผู้สมัครที่เปิดรับ" เป็น "ไม่จำกัดจำนวน"
    await checkOptionByText(page, 'ไม่จำกัดจำนวน');
    await expect(page.getByRole('radio', { name: 'ไม่จำกัดจำนวน' })).toBeChecked();

    // 5. เลือกสาขาวิชาที่เกี่ยวข้องจาก Dropdown
    // (dropdown นี้ปิดตัวเองหลังเลือกแต่ละตัว จึงต้องเปิดใหม่ก่อนเลือกตัวถัดไปทุกครั้ง
    //  ไม่งั้นคลิกครั้งที่ 2 จะไปโดนตำแหน่งอื่นที่ไม่ใช่ dropdown แล้วทำให้ตัวเลือกแรกหลุด)
    const subjectField = page.getByPlaceholder('สาขาวิชาที่เกี่ยวข้อง');
    await subjectField.click();
    await checkOptionByText(page, 'วิศวกรรมซอฟต์แวร์');

    await subjectField.click();
    await checkOptionByText(page, 'วิทยาการคอมพิวเตอร์');

    // ตรวจสอบว่าเลือกครบทั้ง 2 สาขาจริง ก่อนไปขั้นตอนถัดไป
    // (เช็คผ่าน checkbox state โดยตรง แทน getByText เพราะข้อความปรากฏซ้ำ 2 จุด
    //  ทั้งใน "chip" ที่แสดงด้านบนฟิลด์ และใน list ของ dropdown เอง ทำให้ getByText hit 2 elements)
    await expect(
      page.getByRole('checkbox', { name: 'วิศวกรรมซอฟต์แวร์' })
    ).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'วิทยาการคอมพิวเตอร์' })
    ).toBeChecked();

    // ปิด dropdown ด้วยการกด Escape เผื่อยังค้างเปิดอยู่บังฟิลด์ถัดไป
    await page.keyboard.press('Escape');

    // === ระยะเวลาที่เปิดรับสมัคร ===
    // 6. เลือก "ไม่กำหนดระยะเวลา"
    // (ลองคลิกด้วยเมาส์หลายวิธีแล้วไม่สำเร็จ เปลี่ยนมาใช้ keyboard แทน — focus แล้วกด Space
    //  ซึ่งเป็นวิธีมาตรฐานที่ browser ใช้ toggle radio/checkbox ผ่านคีย์บอร์ด
    //  บาง custom component อาจฟัง keyboard event แทน/เพิ่มเติมจาก mouse event)
    const periodRadio = page.getByRole('radio', { name: 'ไม่กำหนดระยะเวลา' });
    await periodRadio.focus();
    await page.keyboard.press('Space');
    await expect(periodRadio).toBeChecked();

    // === เอกสารที่ต้องการเพิ่ม (ถ้ามี) ===
    // 7. ติ๊กเลือก Portfolio และ Resume
    await checkOptionByText(page, 'Portfolio');
    await expect(page.getByRole('checkbox', { name: /Portfolio/ })).toBeChecked();
    await checkOptionByText(page, 'Resume');
    await expect(page.getByRole('checkbox', { name: /Resume/ })).toBeChecked();

    // === รายละเอียดงาน ===
    // 8. กรอกลักษณะงาน
    await page.getByPlaceholder('ลักษณะงาน').fill('เขียน test case');

    // 9. กรอกคุณสมบัติ
    await page.getByPlaceholder('คุณสมบัติ').fill('กำลังศึกษาอยู่ชั้นปริญญาตรี');

    // 10. ฟิลด์ "สวัสดิการ" ต้องแสดงค่าเริ่มต้นอัตโนมัติ (readonly)
    await expect(page.locator('input[value="ไม่มีค่าตอบแทน"]')).toBeVisible();

    // === รายละเอียดผู้ประกาศรับสมัคร ===
    // 11. ชื่อ/อีเมล ต้องเป็นข้อมูลจากบัญชีผู้ใช้ (read-only), เบอร์โทรแก้ไขได้
    await expect(page.locator('input[value="ปรวรรธน์ จรรยาเพศ"]')).toBeVisible();
    await expect(
      page.locator('input[value="700001.tes@pea.co.th"]')
    ).toBeVisible();

    const announcerPhone = page
      .locator('input[value="0818564069"]')
      .or(page.locator('input[type="tel"]'))
      .first();
    await announcerPhone.clear();
    await announcerPhone.fill('0818564069');

    // === รายละเอียดพี่เลี้ยง 1 ===
    // 12. เลือกพี่เลี้ยง
    await page.getByText('เลือกพี่เลี้ยง', { exact: true }).click({ force: true });
    await page.getByText('ปรวรรธน์ จรรยาเพศ').last().click();

    // อีเมล/เบอร์โทรพี่เลี้ยง auto-fill ให้เองหลังเลือก (readonly) — แค่ตรวจสอบค่า
    await expect(page.getByPlaceholder('อีเมลพี่เลี้ยง')).toHaveValue(
      '700001.tes@pea.co.th'
    );
    await expect(page.getByPlaceholder('เบอร์โทรพี่เลี้ยง')).toHaveValue(
      '0818564069'
    );

    // ตรวจสอบก่อน submit ว่าปุ่ม "เผยแพร่ประกาศ" ไม่ได้ถูก disable ไว้
    // (ถ้า disabled แปลว่ามี field บังคับบางช่องที่ยังไม่ผ่าน validation จริงๆ)
    const publishButton = page.getByRole('button', { name: 'เผยแพร่ประกาศ' });
    await expect(publishButton).toBeEnabled();

    // 13. กดปุ่มเผยแพร่ประกาศ
    await publishButton.click();

    // Popup ยืนยัน: "ยืนยันการประกาศหรือไม่" พร้อมปุ่ม "ย้อนกลับ" / "ยืนยัน"
    await expect(page.getByText('ยืนยันการประกาศหรือไม่')).toBeVisible({
      timeout: 10000,
    });

    // 14. กดปุ่มยืนยัน
    await page.getByRole('button', { name: 'ยืนยัน' }).click();

    // ตรวจสอบผลลัพธ์: กลับมาหน้ารายการประกาศ (ไม่มี /create ต่อท้ายแล้ว)
    await expect(page).toHaveURL(/localhost:2700\/owner\/announcements$/, {
      timeout: 15000,
    });

    // ตรวจสอบว่าตำแหน่งใหม่ปรากฏในตาราง พร้อมสถานะ "เปิดรับสมัคร"
    const newRow = page.getByRole('row', { name: new RegExp(positionName, 'i') });
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText('เปิดรับสมัคร')).toBeVisible();

    // === ทำความสะอาด ===
    // ลบประกาศที่เทสนี้สร้างไว้ทิ้ง เพื่อไม่ให้ข้อมูลทดสอบพอกพูนใน database จริง
    // ทุกครั้งที่รันเทส
    await deleteAnnouncementByName(page, positionName);
  });

  // MT-TC-005 (Functional)
  // Scenario: สร้างประกาศรับสมัครฝึกงานไม่สำเร็จ โดยไม่กรอกข้อมูลใดๆ
  test('MT-TC-005 สร้างประกาศรับสมัครฝึกงานไม่สำเร็จ โดยไม่กรอกข้อมูลใดๆ', async ({
    page,
  }) => {
    // 1. กดปุ่ม "เผยแพร่ประกาศ" ทันที โดยไม่กรอกข้อมูลเพิ่มเติมใดๆ
    await page.getByRole('button', { name: 'เผยแพร่ประกาศ' }).click();

    // ต้องไม่มี Popup ยืนยัน "ยืนยันการประกาศหรือไม่" ปรากฏขึ้นมา
    await expect(page.getByText('ยืนยันการประกาศหรือไม่')).not.toBeVisible();

    // ต้องยังอยู่หน้าเดิม (ไม่ถูกพาไปหน้ารายการประกาศ)
    await expect(page).toHaveURL(/localhost:2700\/owner\/announcements\/create/);

    // ช่อง "ชื่อตำแหน่งงาน" ต้องแสดงกรอบสีแดงพร้อมข้อความแจ้งเตือน
    // (เช็คผ่าน class "border-red-300" แทนการอ่านค่าสี CSS โดยตรง เพราะ Chrome บางเวอร์ชัน
    //  คืนค่าเป็น lab(...) แทน rgb(...) ทำให้เช็คด้วย regex สี rgb ไม่เสถียร)
    const positionField = page.getByPlaceholder('ชื่อตำแหน่งงาน');
    await expect(positionField).toHaveClass(/border-red/);
  });
});