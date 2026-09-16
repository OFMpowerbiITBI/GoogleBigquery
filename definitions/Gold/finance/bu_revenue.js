/**
 * definitions/gold/finance/bu_revenue.js
 *
 * CONFIG TYPE: incremental (สร้างด้วย publish() ในไฟล์ .js)   — คู่มือบทที่ 17.4
 *
 * ใช้เมื่อ: ต้องสร้างตารางหลายตัวที่หน้าตาเหมือนกันเป๊ะ ต่างแค่ค่าตัวกรอง
 *   ไฟล์นี้สร้าง 2 ตาราง: revenue_daily_ofm และ revenue_daily_b2s
 *
 * ⚠️ กับดักที่คนพลาดบ่อยที่สุด: ในไฟล์ .js ต้องเรียกผ่าน ctx. เสมอ
 *    ctx.ref() ctx.self() ctx.when() ctx.incremental()
 *    แบบไม่มี ctx. ใช้ได้เฉพาะใน .sqlx เท่านั้น
 *
 * ข้อแลกเปลี่ยนที่ควรรู้ก่อนใช้วิธีนี้:
 *   ได้ความสั้น แต่เสียความอ่านง่าย — คนที่เปิด BigQuery มาเห็นตาราง revenue_daily_ofm
 *   จะหาไฟล์ชื่อนั้นไม่เจอ ต้องรู้ว่ามันถูกสร้างจากลูปในไฟล์นี้
 *   ถ้ามีแค่ 2-3 ตัว เขียนแยกไฟล์ตรง ๆ อ่านง่ายกว่า
 */

const { BUS, TZ, LATE_ARRIVAL_DAYS } = require("includes/constants");

BUS.forEach(bu => {
  publish(`revenue_daily_${bu.toLowerCase()}`, {
    type: "incremental",
    schema: "sbx_gold_finance",
    description: `ยอดขายรายวันระดับสาขาของ ${bu} (สร้างจากลูปใน bu_revenue.js)`,
    tags: ["daily", "gold", "finance", bu.toLowerCase()],
    uniqueKey: ["sales_date", "branch_code"],
    bigquery: {
      partitionBy: "sales_date",
      clusterBy: ["branch_code"],
      updatePartitionFilter: `sales_date >= DATE_SUB(CURRENT_DATE("${TZ}"), INTERVAL ${LATE_ARRIVAL_DAYS} DAY)`
    },
    assertions: {
      uniqueKey: ["sales_date", "branch_code"],
      nonNull: ["sales_date", "branch_code", "net_amount"],
      rowConditions: ["net_amount >= 0", `bu = "${bu}"`]
    },
    columns: {
      sales_date: "วันที่ขายตามเวลาไทย",
      branch_code: "รหัสสาขา",
      bu: "หน่วยธุรกิจของตารางนี้",
      qty_sold: "จำนวนที่ขายรวม",
      net_amount: "ยอดขายสุทธิ (THB)",
      sku_count: "จำนวน SKU ที่ขายได้ในวันนั้น"
    }
  }).query(ctx => `
    SELECT
      sales_date,
      branch_code,
      bu,
      SUM(qty_sold)             AS qty_sold,
      SUM(net_amount)           AS net_amount,
      COUNT(DISTINCT sku_code)  AS sku_count
    FROM ${ctx.ref("slv_sku_daily_sales")}
    WHERE bu = "${bu}"
      ${ctx.when(ctx.incremental(),
        `AND sales_date > DATE_SUB((SELECT MAX(sales_date) FROM ${ctx.self()}), INTERVAL ${LATE_ARRIVAL_DAYS} DAY)`)}
    GROUP BY 1, 2, 3
  `);
});
