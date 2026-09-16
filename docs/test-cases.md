# Test Cases — ใช้พิสูจน์ว่าแต่ละ config ทำงานอย่างที่คิด

> **สถานะ:** `dataform compile` ผ่านแล้วจริง (CLI 3.0.50 / core 3.0.43 — 60 actions ไม่มี error)
> แต่ **ยังไม่มีใครรันบน BigQuery จริง** — ผลลัพธ์ที่เขียนว่า "ผลที่ต้องได้" คือสิ่งที่ควรได้ตามการออกแบบ
> รอบแรกที่รันให้ถือว่าเป็นการยืนยันจริง ถ้าอันไหนไม่ตรง ให้แก้เอกสารนี้ด้วย ไม่ใช่แก้แค่โค้ด

ลำดับการทดสอบ: seed 00 → 01 → รัน Dataform ทั้งหมด → ทำ TC-P (ต้องเขียวหมด)
→ seed 02 → รันอีกครั้ง → ทำ TC-N (ต้องล้มตามที่ระบุ) → seed 02b → full refresh → กลับมาเขียว

แทน `PRJ` ด้วย project ที่ใช้ (ค่าตั้งต้น `ofm-b2s-data-dev`)

---

## A. เทสเคสที่ต้องผ่าน (TC-P)

### TC-P1 · timezone ไม่เพี้ยน (ข้อผิดพลาดที่เคยทำรายงานผิดจริง)
ทดสอบว่ารายการเวลา 00:30 น. ของไทย ถูกนับเป็น "วันนี้" ไม่ใช่ "เมื่อวาน" แบบ UTC

```sql
SELECT
  receipt_no,
  sales_ts,                          -- UTC
  DATE(sales_ts)              AS date_utc_ผิด,
  sales_date                  AS date_th_ถูก
FROM `PRJ.sbx_silver.slv_nexpos_sales_txn`
WHERE receipt_no LIKE "%-1001-900";
```
**ผลที่ต้องได้:** `date_utc_ผิด` = เมื่อวาน · `date_th_ถูก` = วันนี้ (ต่างกัน 1 วัน)

---

### TC-P2 · dedup ที่ชั้น cleansed
bronze มีใบเสร็จเดียวกัน 2 เวอร์ชัน (qty 5 → แก้เป็น 3) silver ต้องเหลือเวอร์ชันล่าสุดตัวเดียว

```sql
SELECT "bronze" AS layer, COUNT(*) AS rows, ANY_VALUE(qty) AS qty
FROM `PRJ.sbx_bronze.nexpos_sales_txn` WHERE receipt_no LIKE "%-2001-901"
UNION ALL
SELECT "silver", COUNT(*), ANY_VALUE(qty)
FROM `PRJ.sbx_silver.slv_nexpos_sales_txn` WHERE receipt_no LIKE "%-2001-901";
```
**ผลที่ต้องได้:** bronze = 2 แถว · silver = 1 แถว และ `qty = 3` (เวอร์ชันที่แก้แล้ว)

---

### TC-P3 · incremental แบบ append ไม่สร้างแถวซ้ำเมื่อรันซ้ำ
รัน action `slv_nexpos_stock_movement` ซ้ำ 2 ครั้งติดกัน แล้วเทียบจำนวนแถว

```sql
SELECT COUNT(*) AS rows, COUNT(DISTINCT doc_no) AS distinct_docs
FROM `PRJ.sbx_silver.slv_nexpos_stock_movement`;
```
**ผลที่ต้องได้:** `rows = distinct_docs` และตัวเลขไม่เพิ่มขึ้นจากการรันรอบที่ 2

---

### TC-P4 · snapshot + protected
1. รัน `slv_sap_material_master` 2 ครั้งในวันเดียวกัน
2. ลองสั่ง **Run with full refresh** ที่ action นี้

```sql
SELECT snapshot_date, COUNT(*) AS sku_rows
FROM `PRJ.sbx_silver.slv_sap_material_master`
GROUP BY 1 ORDER BY 1 DESC;
```
**ผลที่ต้องได้:** 1 snapshot ต่อ 1 วันเท่านั้น · full refresh ถูกปฏิเสธเพราะ `protected: true`

---

### TC-P5 · MERGE/upsert ทับแถวเดิม ไม่เพิ่มแถวใหม่
seed ส่งออเดอร์ที่เคยเป็น `pending` กลับมาใหม่เป็น `paid`

```sql
-- ต้องไม่มี key ซ้ำเลย
SELECT order_id, line_no, COUNT(*) AS c
FROM `PRJ.sbx_silver.slv_ecom_order_header`
GROUP BY 1, 2 HAVING c > 1;

-- ออเดอร์ที่ถูกอัปเดตวันนี้ต้องเป็น paid
SELECT order_id, line_no, order_status, source_updated_ts
FROM `PRJ.sbx_silver.slv_ecom_order_header`
WHERE DATE(source_updated_ts, "Asia/Bangkok") = CURRENT_DATE("Asia/Bangkok")
ORDER BY order_id;
```
**ผลที่ต้องได้:** query แรกคืน 0 แถว · query ที่สองมี 3 แถวและ `order_status = "paid"` ทุกแถว

---

### TC-P6 · `updatePartitionFilter` ถูกใส่ลงใน MERGE จริง
```bash
dataform compile --json > graph.json
```
เปิดดู SQL ของ `slv_ecom_order_header` / `fact_cover_days` (หรือกด **Compiled queries** ใน UI)

**ผลที่ต้องได้:** เห็น `MERGE` ที่มีเงื่อนไข `order_date >= DATE_SUB(CURRENT_DATE("Asia/Bangkok"), INTERVAL 7 DAY)`
อยู่ใน `ON` — ถ้าไม่เห็น แปลว่า config หล่นไป และจะสแกนทั้งตารางทุกวัน

---

### TC-P7 · operations + hasOutput + post_operations
```sql
SELECT logged_at, action_name, row_count, note
FROM `PRJ.sbx_utility.etl_run_log`
ORDER BY logged_at DESC LIMIT 10;
```
**ผลที่ต้องได้:** มีแถว `phms_sku_health` (จาก post_operations) และ `pipeline_heartbeat` (จาก `operate()`)
`note` ต้องเป็น `env=sandbox` ตามค่า vars

---

### TC-P8 · `disabled: true`
```sql
SELECT table_name, table_type
FROM `PRJ.sbx_gold_marketing.INFORMATION_SCHEMA.TABLES`;
```
**ผลที่ต้องได้:** **ไม่มี** `campaign_roas` ใน BigQuery แต่ยังเห็นใน DAG ของ Dataform และ compile ผ่าน

---

### TC-P9 · materialized view ถูกสร้างเป็น MV จริง
```sql
SELECT table_name, table_type
FROM `PRJ.sbx_gold_supply_chain.INFORMATION_SCHEMA.TABLES`
WHERE table_name = "mv_daily_sales_branch";
```
**ผลที่ต้องได้:** `table_type = "MATERIALIZED VIEW"` (ไม่ใช่ `VIEW`)

---

### TC-P10 · tag ใช้เลือกรันได้จริง
```bash
dataform run --tags silver --dry-run     # ต้องเห็นเฉพาะ action ชั้น silver
dataform run --tags phms  --dry-run      # ต้องเห็นเฉพาะโดเมน PHMS
dataform run --tags weekly --dry-run     # ต้องเห็น sell_through_rate + abc_xyz_segment
```
**ผลที่ต้องได้:** รายการ action ตรงกับ tag ที่เลือก — นี่คือกลไกเดียวกับที่ workflow config และ Airflow ใช้

---

### TC-P11 · assertion ทุกตัวผ่าน และดูผลได้
```sql
SELECT table_name
FROM `PRJ.sbx_dataform_assertions.INFORMATION_SCHEMA.TABLES`
ORDER BY 1;

-- แต่ละตัวต้องคืน 0 แถว
SELECT COUNT(*) FROM `PRJ.sbx_dataform_assertions.assert_phms_coverage`;
SELECT COUNT(*) FROM `PRJ.sbx_dataform_assertions.assert_sales_freshness`;
SELECT COUNT(*) FROM `PRJ.sbx_dataform_assertions.assert_no_future_sales`;
```
**ผลที่ต้องได้:** ทุก assertion คืน 0 แถว (assertion คืนแถว = สอบตก)

---

### TC-P12 · assertion บล็อกการรันต่อได้
ดู DAG ของ `phms_branch_score`

**ผลที่ต้องได้:** `assert_sales_freshness` เป็น dependency ต้นน้ำ — ถ้ามันตก `phms_branch_score` จะไม่รัน
(ทดสอบจริงได้โดยลบยอดขายเมื่อวานออกจาก bronze ชั่วคราว)

---

### TC-P13 · vars สลับ environment ได้โดยไม่แก้โค้ด
```bash
dataform compile --vars=environment=prod | grep "env="
```
**ผลที่ต้องได้:** SQL ใน post_operations เปลี่ยนเป็น `env=prod` โดยไม่ต้องแก้ไฟล์ใด ๆ
(กลไกเดียวกับที่ release config ของ production ใช้ override `sourceProject` / `sourceDataset`)

---

### TC-P14 · PDPA — ไม่มี PII หลุดขึ้นชั้นบน
```sql
SELECT table_schema, table_name, column_name
FROM `PRJ.sbx_silver.INFORMATION_SCHEMA.COLUMNS`
WHERE LOWER(column_name) LIKE "%email%"
   OR LOWER(column_name) LIKE "%phone%"
   OR LOWER(column_name) LIKE "%customer_name%"
UNION ALL
SELECT table_schema, table_name, column_name
FROM `PRJ.sbx_gold_merchandise.INFORMATION_SCHEMA.COLUMNS`
WHERE LOWER(column_name) LIKE "%email%";
```
**ผลที่ต้องได้:** 0 แถว — มีแต่ `customer_hash` ที่ผ่าน SHA256 แล้ว

---

### TC-P15 · ยอดขายรวมของ silver ตรงกับ bronze (reconciliation)
```sql
WITH b AS (
  SELECT SUM(net_amount) AS amt
  FROM (
    SELECT net_amount FROM `PRJ.sbx_bronze.nexpos_sales_txn`
    WHERE sku_code IS NOT NULL AND qty > 0
    QUALIFY ROW_NUMBER() OVER (PARTITION BY receipt_no, line_no ORDER BY updated_ts DESC) = 1
  )
),
s AS (SELECT SUM(net_amount) AS amt FROM `PRJ.sbx_silver.slv_nexpos_sales_txn` WHERE qty > 0)
SELECT b.amt AS bronze_amt, s.amt AS silver_amt, b.amt - s.amt AS diff FROM b, s;
```
**ผลที่ต้องได้:** `diff = 0` (ถ้าเพิ่งรัน seed 02 จะไม่เท่า เพราะมีแถว qty ติดลบ — ถือว่าถูกต้อง)

---

## B. เทสเคสที่ต้อง "ล้ม" (TC-N) — รัน `seed/02_seed_bad_rows.sql` ก่อน

| # | ข้อมูลเสียที่ใส่ | assertion ที่ต้องล้ม | ชนิด |
|---|---|---|---|
| TC-N1 | ขาย qty = -3 | `slv_nexpos_sales_txn_assertions_rowConditions` | `rowConditions` |
| TC-N2 | ออเดอร์ที่ `branch_code` เป็น NULL | `slv_ecom_order_header_assertions_nonNull` | `nonNull` |
| TC-N3 | สาขา 1001 ซ้ำ 2 แถว | `dim_branch_assertions_uniqueKey` | `uniqueKeys` |
| TC-N4 | สาขา 2004 เปิด 10 วันแล้วไม่มี planogram | `assert_phms_coverage` | manual assertion |
| TC-N5 | ปรับสต็อก -99999 | `slv_stock_onhand_daily_..._rowConditions` และลามไปที่ `sell_through_rate` (`str_pct` หลุด 0-1) | `rowConditions` แบบลูกโซ่ |

ดูว่าผิดที่แถวไหนจริง ๆ ได้จาก view ผลลัพธ์:
```sql
SELECT * FROM `PRJ.sbx_dataform_assertions.assert_phms_coverage`;
SELECT * FROM `PRJ.sbx_dataform_assertions.dim_branch_assertions_uniqueKey`;
```

### TC-N6 · บทเรียนสำคัญ — ลบข้อมูลเสียที่ต้นทางแล้วยังไม่หายจาก incremental
หลังรัน `seed/02b_undo_bad_rows.sql` แล้วรัน Dataform ปกติ:

- ตารางที่เป็น **view / table** → หายเอง เพราะสร้างใหม่ทั้งก้อน
- ตารางที่เป็น **incremental** (`slv_ecom_order_header`, `slv_nexpos_stock_movement`) → **แถวเสียยังอยู่**
  เพราะ incremental ไม่เคยลบของเก่า ต้องสั่ง **Run with full refresh** เฉพาะตารางเหล่านั้น

```sql
-- ตรวจว่าแถวเสียหายไปหรือยัง
SELECT COUNT(*) FROM `PRJ.sbx_silver.slv_ecom_order_header` WHERE branch_code IS NULL;
SELECT COUNT(*) FROM `PRJ.sbx_silver.slv_nexpos_stock_movement` WHERE doc_no LIKE "BAD-%";
```
**ผลที่ต้องได้:** ก่อน full refresh ≠ 0 · หลัง full refresh = 0
(และ `slv_sap_material_master` จะ full refresh ไม่ได้เพราะ `protected: true` — นั่นคือพฤติกรรมที่ถูกต้อง)

### TC-N7 · (ทำเอง) ขอบของ `updatePartitionFilter` — ข้อมูลมาช้าเกินหน้าต่าง
เทสนี้ไม่ได้อยู่ใน seed เพราะทำให้ TC-P5 เพี้ยน — รันเองเมื่ออยากเห็นพฤติกรรมจริง

```sql
-- หยิบออเดอร์ที่เก่ากว่า 7 วันมาส่งใหม่พร้อมสถานะที่เปลี่ยน
INSERT INTO `PRJ.sbx_bronze.ecom_order_header`
SELECT * REPLACE (
  "delivered" AS order_status,
  CURRENT_TIMESTAMP() AS updated_ts
)
FROM `PRJ.sbx_bronze.ecom_order_header`
WHERE run_date < DATE_SUB(CURRENT_DATE("Asia/Bangkok"), INTERVAL 7 DAY)
LIMIT 1;
```
รัน `slv_ecom_order_header` แล้วดู

**ผลที่ต้องได้:** แถวปลายทางอยู่นอกหน้าต่าง 7 วัน → `MERGE` หาไม่เจอ → **INSERT เป็นแถวใหม่ = คีย์ซ้ำ**
และ `..._assertions_uniqueKey_0` ต้องล้ม
→ นี่คือเหตุผลที่ `constants.LATE_ARRIVAL_DAYS` ต้องตั้งให้ครอบคลุมพฤติกรรมจริงของ source
ไม่ใช่ตั้งให้เล็กที่สุดเพื่อประหยัดอย่างเดียว · แก้กลับด้วย full refresh ของตารางนี้

---

## C. เช็คลิสต์ก่อนบอกว่า sandbox "ผ่าน"

- [ ] `dataform compile` ไม่มี error และ wall time < 30 วินาที
- [ ] รัน All actions ผ่านทั้งหมด รวม assertion (ก่อน seed 02)
- [ ] TC-P1 ถึง TC-P15 ได้ผลตามที่ระบุ
- [ ] หลัง seed 02 มี assertion ล้มครบ 5 ตัวตาม TC-N1..N5 — ไม่ใช่ล้มมั่ว
- [ ] หลัง seed 02b + full refresh กลับมาเขียวทั้งหมด
- [ ] ทุกตารางในชั้น gold มี description + columns ครบ (ดูใน BigQuery ไม่ใช่แค่ในโค้ด)
