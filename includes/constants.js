/**
 * includes/constants.js
 *
 * ค่าคงที่ระดับ repository — ไฟล์ที่อยู่ชั้นบนสุดของ includes/ ถูก import ให้อัตโนมัติ
 * เรียกใช้ใน SQLX ได้เลย เช่น ${constants.TZ}
 *
 * ทำไมต้องมี: คู่มือบทที่ 29 ห้าม hardcode ชื่อ project/dataset และห้ามสมมติ timezone
 *            ค่าที่ใช้ซ้ำทั้ง repo ควรอยู่ที่เดียวเพื่อแก้ทีเดียวจบ
 */

// timezone ธุรกิจ — ทุกการแปลงวันที่ต้องอ้างค่านี้ ห้ามสมมติว่า source เป็นเวลาไทยแล้ว
const TZ = "Asia/Bangkok";

// จำนวนวันที่ยอมรับว่าข้อมูลมาช้าได้ ใช้กับ updatePartitionFilter ของ incremental ทุกตัว
const LATE_ARRIVAL_DAYS = 7;

// วันแรกที่มีข้อมูลใน sandbox — ใช้เป็น checkpoint ตอนรันรอบแรก
const DATA_START = "2026-01-01";

// อายุข้อมูลที่เก็บในชั้น gold (ใช้ใน _utilities/purge_expired_partitions)
const GOLD_RETENTION_DAYS = 730;

// BU ที่มีในองค์กร ใช้สร้าง action แบบวนลูป (ดู definitions/gold/finance/bu_revenue.js)
const BUS = ["OFM", "B2S"];

// label สำหรับ cost allocation — ติดกับทุกตารางที่ Dataform สร้างใน sandbox
const LABELS = {
  owner: "smart-data",
  env: "sandbox",
  managed_by: "dataform"
};

module.exports = {
  TZ,
  LATE_ARRIVAL_DAYS,
  DATA_START,
  GOLD_RETENTION_DAYS,
  BUS,
  LABELS
};
