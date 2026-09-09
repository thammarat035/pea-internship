/**
 * รันไฟล์เทสแต่ละไฟล์แยกกันคนละโปรเซส (แทนที่จะให้ `bun test` รวมทุกไฟล์
 * ไว้ในโปรเซสเดียว) เพื่อป้องกันปัญหา mock.module() ของไฟล์หนึ่ง "รั่วไหล"
 * ไปกระทบอีกไฟล์หนึ่ง ซึ่งเป็นพฤติกรรมที่ Bun ตั้งใจออกแบบมาแบบนี้
 * (module cache ใช้ร่วมกันทั้งโปรเซส) และไม่มีทาง "ล้าง" มันได้ทันเวลา
 * ด้วย mock.restore() เพราะ mock.module() มักถูกเรียกตั้งแต่ตอน "collection
 * phase" ซึ่งเกิดขึ้นก่อนที่ hook อย่าง afterAll จะมีโอกาสทำงานเสียอีก
 *
 * วิธีใช้:
 *   bun scripts/test-all.ts                  -> รันทุกไฟล์ .test.ts ใน src/
 *   bun scripts/test-all.ts src/modules/xyz   -> รันเฉพาะไฟล์ในโฟลเดอร์ที่ระบุ
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function findTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await findTestFiles(fullPath)));
    } else if (entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

const targetDir = process.argv[2] ?? "src";
const testFiles = (await findTestFiles(targetDir)).sort();

if (testFiles.length === 0) {
  console.log(`ไม่พบไฟล์ .test.ts ในโฟลเดอร์ "${targetDir}"`);
  process.exit(0);
}

console.log(
  `พบไฟล์เทสทั้งหมด ${testFiles.length} ไฟล์ กำลังรันทีละไฟล์แบบแยกโปรเซส...\n`,
);

let hasFailure = false;

for (const file of testFiles) {
  console.log(`\n▶ ${file}`);

  // Bun.spawnSync รันคำสั่ง `bun test <ไฟล์นี้ไฟล์เดียว>` เป็นโปรเซสใหม่แยกต่างหาก
  // ทำให้ module cache ของไฟล์นี้ไม่ปะปนกับไฟล์อื่นเลย
  const result = Bun.spawnSync(["bun", "test", file], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    hasFailure = true;
  }
}

console.log("\n" + "=".repeat(60));
console.log(hasFailure ? "❌ มีบางไฟล์เทสไม่ผ่าน" : "✅ ไฟล์เทสทั้งหมดผ่านหมด");
console.log("=".repeat(60));

process.exit(hasFailure ? 1 : 0);