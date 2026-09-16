/**
 * includes/helpers.js
 *
 * ฟังก์ชันสร้าง SQL ที่ใช้ซ้ำ — ทำงานตอน compile เท่านั้น (V8 เปล่า ๆ ไม่มี Node API)
 * ใช้ใน SQLX: ${helpers.bkkDate("sales_ts")}
 */

const { TZ, LATE_ARRIVAL_DAYS } = require("includes/constants");

/** แปลง TIMESTAMP (UTC) เป็นวันที่ทางธุรกิจ Asia/Bangkok — ห้ามใช้ DATE(ts) เปล่า ๆ */
function bkkDate(col) {
  return `DATE(${col}, "${TZ}")`;
}

/** แปลง TIMESTAMP (UTC) เป็นเวลานาฬิกาท้องถิ่น (DATETIME) */
function bkkDatetime(col) {
  return `DATETIME(${col}, "${TZ}")`;
}

/** เงินบาท: ปัดทศนิยม 2 ตำแหน่งแล้ว cast เป็น NUMERIC เสมอ (ห้าม FLOAT64) */
function thb(col) {
  return `CAST(ROUND(${col}, 2) AS NUMERIC)`;
}

/** hash ค่า PII ก่อนเข้าชั้น silver/gold ตาม PDPA */
function hashPii(col) {
  return `TO_HEX(SHA256(CAST(${col} AS STRING)))`;
}

/** ช่วง partition ที่ยอมให้ MERGE แตะ — ใช้กับ updatePartitionFilter ของ incremental ทุกตัว */
function lateWindow(dateCol, days = LATE_ARRIVAL_DAYS) {
  return `${dateCol} >= DATE_SUB(CURRENT_DATE("${TZ}"), INTERVAL ${days} DAY)`;
}

/** จัด RAG ตามเกณฑ์กลางของ PHMS — นิยามเดียวใช้ทุกที่ */
function ragCase(scoreCol) {
  return `CASE
      WHEN ${scoreCol} >= 80 THEN "G"
      WHEN ${scoreCol} >= 60 THEN "A"
      ELSE "R"
    END`;
}

/** เก็บเฉพาะแถวล่าสุดต่อ 1 business key — ใช้ตัดแถวซ้ำที่ชั้น silver/cleansed */
function latestPerKey(keyCols, orderCol) {
  return `QUALIFY ROW_NUMBER() OVER (
      PARTITION BY ${keyCols.join(", ")}
      ORDER BY ${orderCol} DESC
    ) = 1`;
}

module.exports = {
  bkkDate,
  bkkDatetime,
  thb,
  hashPii,
  lateWindow,
  ragCase,
  latestPerKey
};
