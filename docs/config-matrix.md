# Config Matrix — config ทุกชนิดอยู่ไฟล์ไหน

ตารางนี้คือสารบัญของ sandbox: เปิดหาชนิด config ที่อยากดู แล้วไปอ่านไฟล์นั้นได้เลย
ทุกไฟล์มีคอมเมนต์หัวไฟล์อธิบายว่า "ทำไมถึงเลือกแบบนี้" ไม่ใช่แค่ "ทำอะไร"

## 1. `type` ครบทุกค่า

| type | ไฟล์ตัวอย่าง | ได้อะไรใน BigQuery | ใช้เมื่อ |
|---|---|---|---|
| `declaration` | `bronze/nexpos/nexpos_sales_txn.sqlx` | ไม่สร้างอะไร — แค่ให้ `ref()` ได้ | ตารางที่ Airflow/ระบบอื่นสร้างไว้แล้ว |
| `declaration` (JS) | `bronze/bronze_sources.js` | เหมือนกัน แต่ประกาศหลายตัวด้วย `declare()` | source เยอะและเหมือนกันหมด |
| `view` | `silver/cleansed/slv_nexpos_sales_txn.sqlx` | `CREATE OR REPLACE VIEW` | logic เบา อยากได้ค่าล่าสุดเสมอ |
| `view` + `materialized: true` | `gold/supply_chain/mv_daily_sales_branch.sqlx` | Materialized View | aggregate ง่าย ๆ จากตารางเดียว |
| `table` | `silver/conformed/slv_sku_daily_sales.sqlx` | `CREATE OR REPLACE TABLE` | เริ่มจากตัวนี้ก่อนเสมอ |
| `incremental` | 5 แบบ ดูหัวข้อ 2 | `INSERT` หรือ `MERGE` | ตารางใหญ่ สร้างใหม่ทั้งก้อนแพงเกิน |
| `operations` | `_utilities/purge_expired_partitions.sqlx` | SQL ตรง ๆ หลายคำสั่ง | งานที่ไม่ใช่การสร้างตาราง |
| `operations` + `hasOutput: true` | `_utilities/etl_run_log.sqlx` | ตารางที่คนอื่น ref ได้ | สร้างตารางด้วยมือแบบเต็มที่ |
| `operations` (JS) | `_utilities/ops_extras.js` | เหมือนกัน แต่ใช้ `operate()` | สร้างหลายตัวด้วยลูป |
| `assertion` | `gold/phms/assert_phms_coverage.sqlx` | view เก็บแถวที่ผิด | ตรวจสิ่งที่ built-in assertion ทำไม่ได้ |
| `assertion` (JS) | `_utilities/ops_extras.js` | เหมือนกัน แต่ใช้ `assert()` | — |
| `publish()` ใน JS | `gold/finance/bu_revenue.js` | สร้าง 2 ตารางจากลูป | ตารางหน้าตาเหมือนกันหลายตัว |

## 2. `incremental` ครบทั้ง 5 แบบตามคู่มือบทที่ 11

| แบบ | ไฟล์ | กลไก | จุดที่ต้องระวัง |
|---|---|---|---|
| 1. Append | `silver/cleansed/slv_nexpos_stock_movement.sqlx` | ไม่มี `uniqueKey` → `INSERT` | ข้อมูลที่มาช้ากว่า watermark จะหายไปเงียบ ๆ |
| 2. Snapshot รายวัน | `silver/cleansed/slv_sap_material_master.sqlx` | เทียบ `MAX(snapshot_date)` | ต้อง `protected: true` ไม่งั้น full refresh ลบประวัติหมด |
| 3. MERGE / upsert | `silver/cleansed/slv_ecom_order_header.sqlx` | มี `uniqueKey` → `MERGE` | source ต้องไม่มี key ซ้ำในรอบเดียว → ต้อง `QUALIFY` ก่อน |
| 4. MERGE + `updatePartitionFilter` | ไฟล์เดียวกัน + `gold/supply_chain/fact_cover_days.sqlx` | จำกัด partition ที่ MERGE แตะ | ถ้าไม่ใส่ = สแกนทั้งตารางทุกวัน (ค่าใช้จ่ายอันดับ 1) |
| 5. `pre_operations` checkpoint | `silver/cleansed/slv_nexpos_stock_movement.sqlx` | `DECLARE` ค่าไว้ก่อน | ทำให้ BigQuery prune partition ฝั่งต้นทางได้ |

## 3. Property ใน `config`

| property | ไฟล์ตัวอย่าง | หมายเหตุ |
|---|---|---|
| `schema` / `database` | ทุกไฟล์ / `bronze/*.sqlx` | bronze ใช้ `vars` เพื่อสลับ dev↔prod |
| `description` + `columns` | ทุกไฟล์ชั้น gold | บังคับตาม Definition of Done |
| `columns` แบบ record ซ้อน | `gold/phms/phms_sku_health.sqlx` (`detail`) | อธิบายฟิลด์ใน STRUCT ได้ |
| `tags` 3 มิติ | ทุกไฟล์ | ความถี่ + ชั้นข้อมูล + โดเมน |
| `dependencies` | `gold/phms/phms_branch_score.sqlx` | ผูกกับ assertion เพื่อ "บล็อก" การรันต่อ |
| `dependOnDependencyAssertions` | `gold/merchandise/abc_xyz_segment.sqlx` | ขึ้นกับ assertion ของทุก dependency |
| `includeDependentAssertions` | ไฟล์เดียวกัน — ใส่ใน `ref({name:"dim_sku", includeDependentAssertions:false})` | ยกเว้นรายตัว มีลำดับสูงกว่าค่ารวม · **ห้าม**ประกาศใน `dependencies` พร้อมกับ `ref()` ธรรมดา จะชนกันเอง |
| `disabled` | `gold/marketing/campaign_roas.sqlx` | ยังอยู่ใน DAG แต่ไม่รัน |
| `protected` | `silver/cleansed/slv_sap_material_master.sqlx` | ห้าม full refresh |
| `onSchemaChange` | `slv_sap_material_master` / `slv_ecom_order_header` | ใช้ `EXTEND` — ห้ามใช้ `SYNCHRONIZE` |
| `uniqueKey` (incremental) | `slv_ecom_order_header` | ตัวที่เปลี่ยน INSERT → MERGE |
| `assertions.uniqueKey` | เกือบทุกไฟล์ | ตรวจ grain |
| `assertions.uniqueKeys` (หลายชุด) | `silver/dimensions/dim_branch.sqlx` | ตรวจทั้ง business key และ surrogate key |
| `assertions.nonNull` | เกือบทุกไฟล์ | คีย์และ measure หลัก |
| `assertions.rowConditions` | เกือบทุกไฟล์ | กฎธุรกิจ เช่น `str_pct BETWEEN 0 AND 1` |
| `metadata` | `silver/dimensions/dim_sku.sqlx` | Knowledge Catalog — core 3.0.43 รับเฉพาะ `overview` (ใส่ `extraProperties.generic` แล้ว compile ไม่ผ่าน) |
| `bigqueryPolicyTags` | `dim_sku.sqlx` (comment ไว้) | ต้องมี taxonomy + สิทธิ์ SA ก่อน |

## 4. บล็อก `bigquery { }`

| property | ไฟล์ตัวอย่าง |
|---|---|
| `partitionBy` | ทุกตารางที่มีมิติเวลา |
| `clusterBy` | ทุกตารางใหญ่ (สูงสุด 4 คอลัมน์) |
| `partitionExpirationDays` | `silver/conformed/slv_sku_daily_sales.sqlx` |
| `updatePartitionFilter` | `slv_ecom_order_header` · `fact_cover_days` · `bu_revenue.js` |
| `labels` | `slv_sku_daily_sales` · `sell_through_rate` · `fact_cover_days` |
| `additionalOptions` | `gold/phms/phms_sku_health.sqlx` (`friendly_name`) |
| `requirePartitionFilter` | `phms_sku_health.sqlx` — comment ไว้พร้อมเหตุผลว่าทำไมถึงยังไม่เปิด |

## 5. บล็อกอื่นในไฟล์ SQLX

| บล็อก | ไฟล์ตัวอย่าง | จุดที่พลาดบ่อย |
|---|---|---|
| `js { }` | `silver/conformed/slv_sku_daily_sales.sqlx` | ทำงานตอน compile ไม่ใช่ตอน query รัน |
| `pre_operations { }` | `slv_stock_onhand_daily` · `slv_nexpos_stock_movement` | หลายคำสั่งคั่นด้วย `---` ไม่ใช่ `;` |
| `post_operations { }` | `gold/phms/phms_sku_health.sqlx` | รันหลังสร้างตารางเสร็จ |

## 6. ฟังก์ชันในตัว

| ฟังก์ชัน | ไฟล์ตัวอย่าง |
|---|---|
| `ref()` | ทุกไฟล์ |
| `resolve()` | `phms_sku_health` (post_operations) · `ops_extras.js` |
| `self()` | incremental ทุกตัว |
| `when()` / `incremental()` | incremental ทุกตัว |
| `name()` | `phms_sku_health` (เขียนชื่อ action ลง log) |
| `dataform.projectConfig.vars.*` | `bronze/*.sqlx` · `phms_sku_health` |
| `ctx.*` ในไฟล์ .js | `bu_revenue.js` · `ops_extras.js` |

## 7. ของที่ "ไม่ได้" ใส่ไว้ และเหตุผล

| ไม่ได้ใส่ | เหตุผล |
|---|---|
| `ref("dataset", "table")` แบบ 2 อาร์กิวเมนต์ | ใช้เมื่อชื่อตารางชนกันข้าม dataset — sandbox นี้ไม่มีชื่อชน |
| `name:` เปลี่ยนชื่อตารางปลายทาง | ชื่อไฟล์ = ชื่อตารางอยู่แล้ว การเปลี่ยนชื่อเพิ่มภาระให้คนอ่าน (`bu_revenue.js` ตั้งชื่อแบบไดนามิกอยู่แล้ว) |
| `hermetic` | ใช้เฉพาะกรณีมี input ที่ Dataform มองไม่เห็น ซึ่ง sandbox นี้ไม่มี |
| `partitionBy` แบบ `RANGE_BUCKET` | ไม่มีตารางไหนที่ partition ด้วย integer เหมาะกว่าวันที่ |
| `iceberg` / `defaultIcebergConfig` | ยังไม่มี use case ในทีม |
| unit test | Dataform บน GCP ไม่มี `dataform test` — คุณภาพข้อมูลทำผ่าน assertion เท่านั้น |
| `package.json` | repo ที่ใช้ `workflow_settings.yaml` ห้ามมีไฟล์นี้ (compile ไม่ผ่าน) — pin เวอร์ชันด้วย `dataformCoreVersion` แทน |
