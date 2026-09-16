/**
 * definitions/_utilities/ops_extras.js
 *
 * CONFIG TYPE: operations + assertion (สร้างด้วย JavaScript)   — คู่มือบทที่ 17.5
 *
 * เมธอดระดับ global ที่ใช้ได้ในไฟล์ .js:
 *   declare()  → data source declaration   (ดู definitions/bronze/bronze_sources.js)
 *   publish()  → table / view / incremental (ดู definitions/gold/finance/bu_revenue.js)
 *   operate()  → custom SQL operation       (ไฟล์นี้)
 *   assert()   → manual assertion           (ไฟล์นี้)
 *
 * ไฟล์นี้มีไว้เพื่อให้ครบทั้ง 4 เมธอด — ของจริงถ้ามีแค่ตัวเดียวควรเขียนเป็น .sqlx ตรง ๆ จะอ่านง่ายกว่า
 */

const { TZ } = require("includes/constants");

// ---------------------------------------------------------------------------
// operate() — เขียน heartbeat ลง log ทุกรอบที่ pipeline รันจบ
// ใช้ resolve() ไม่ใช่ ref() แล้วประกาศ dependencies เอง เพื่อไม่ให้เกิด dependency ซ้ำซ้อน
// ---------------------------------------------------------------------------
operate("log_pipeline_heartbeat")
  // ถ้าไม่ระบุ .schema() action จะไปอยู่ใน defaultDataset (sbx_gold) ซึ่งผิดชั้น — ต้องระบุเสมอ
  .schema("sbx_utility")
  .tags(["daily", "utility", "monitoring"])
  .dependencies(["etl_run_log"])
  .queries(ctx => `
    INSERT INTO ${ctx.resolve("etl_run_log")} (logged_at, action_name, row_count, note)
    SELECT CURRENT_TIMESTAMP(), "pipeline_heartbeat", 0,
           CONCAT("run_date_th=", CAST(CURRENT_DATE("${TZ}") AS STRING))
  `);

// ---------------------------------------------------------------------------
// assert() — กันข้อมูลวันที่อนาคต ซึ่งมักแปลว่า timezone ของ source ถูกตีความผิด
// assertion คืนแถว = สอบตก → ถ้ามียอดขายของ "พรุ่งนี้" แสดงว่ามีที่ไหนสักแห่งแปลง timezone ผิด
// ---------------------------------------------------------------------------
assert("assert_no_future_sales")
  .tags(["daily", "silver", "data_quality"])
  .query(ctx => `
    SELECT sales_date, branch_code, sku_code
    FROM ${ctx.ref("slv_sku_daily_sales")}
    WHERE sales_date > CURRENT_DATE("${TZ}")
  `);
