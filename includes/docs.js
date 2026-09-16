/**
 * includes/docs.js
 *
 * คำอธิบายคอลัมน์ที่ใช้ซ้ำหลายตาราง — เขียนครั้งเดียว ไปโผล่ทั้ง BigQuery,
 * Knowledge Catalog และ Power BI (คู่มือบทที่ 16.2)
 *
 * ใช้ใน SQLX: columns: { sku_code: docs.sku_code }
 */

const sku_code = "รหัสสินค้า 13 หลัก อ้างอิง SAP material master";
const branch_code = "รหัสสาขา 4 หลัก อ้างอิง dim_branch";
const bu = "หน่วยธุรกิจ: OFM = OfficeMate, B2S = B2S";
const snapshot_date = "วันที่ของข้อมูล ตามเวลา Asia/Bangkok";
const sales_date = "วันที่ขายตามปฏิทินธุรกิจ (แปลงจาก sales_ts ด้วย Asia/Bangkok)";
const sales_ts = "เวลาที่เกิดรายการขาย เป็น TIMESTAMP UTC ตามที่ POS ส่งมา";
const updated_ts = "เวลาที่แถวนี้ถูกแก้ไขล่าสุดที่ต้นทาง (UTC) ใช้เป็น watermark ของ incremental";
const run_date = "วันที่ Airflow โหลดข้อมูลชุดนี้เข้า bronze (partition key ของชั้น bronze)";
const net_amount_thb = "มูลค่าสุทธิหลังส่วนลด หน่วยบาท เก็บเป็น NUMERIC ห้ามใช้ FLOAT64";
const rag_status = "R = ต่ำกว่า 60, A = 60-79, G = 80 ขึ้นไป";
const customer_hash = "อีเมลลูกค้าที่ผ่าน SHA256 แล้ว — ห้ามเก็บค่าดิบตาม PDPA";

module.exports = {
  sku_code,
  branch_code,
  bu,
  snapshot_date,
  sales_date,
  sales_ts,
  updated_ts,
  run_date,
  net_amount_thb,
  rag_status,
  customer_hash
};
