# Setup Flow — เอา repo นี้ขึ้น Dataform ตั้งแต่ศูนย์

ลำดับนี้ห้ามสลับ: **IAM → seed → repo → workspace → รันมือ → ทดสอบ → ตั้งเวลา → alert**
แต่ละเฟสมี "เกณฑ์ผ่าน" ถ้ายังไม่ผ่านอย่าข้ามไปเฟสถัดไป เพราะ error จะไปโผล่ที่เฟสหลังแล้วหาต้นเหตุยาก

ค่าที่ใช้ในเอกสารนี้ (sandbox): project `ofm-b2s-data-dev` · region `asia-southeast1` ·
repository `ofm-dataform-sandbox` · SA `sa-dataform-dev`

---

## Phase 0 · เปิด API และตั้ง IAM  ⏱ ~20 นาที · ทำครั้งเดียวต่อ project

90% ของ error ตอนเริ่มต้นมาจากเฟสนี้ โดยเฉพาะข้อ 3 ที่คนลืมบ่อยที่สุด

```bash
gcloud services enable dataform.googleapis.com bigquery.googleapis.com \
  developerconnect.googleapis.com --project=ofm-b2s-data-dev
```

```bash
PROJECT=ofm-b2s-data-dev
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
SA=sa-dataform-dev@$PROJECT.iam.gserviceaccount.com
AGENT=service-$PROJECT_NUMBER@gcp-sa-dataform.iam.gserviceaccount.com

# 1) สร้าง SA ที่ Dataform จะใช้รัน BigQuery job จริง
gcloud iam service-accounts create sa-dataform-dev \
  --display-name="Dataform execution SA (dev/sandbox)" --project=$PROJECT

# 2) ให้สิทธิ์ BigQuery กับ SA
for ROLE in roles/bigquery.dataEditor roles/bigquery.dataViewer roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="$ROLE"
done

# 3) ให้ Dataform service agent สวมบทบาท SA ได้ — ข้อที่ลืมบ่อยที่สุด
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="serviceAccount:$AGENT" --role="roles/iam.serviceAccountTokenCreator"
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="serviceAccount:$AGENT" --role="roles/iam.serviceAccountUser"

# 4) strict act-as: คนที่กดรันต้องสวมบทบาท SA ได้ด้วย
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member="group:smart-data-team@ofm.co.th" --role="roles/iam.serviceAccountUser"
```

ตัวเราเองต้องมี `roles/dataform.admin` (หรือ `dataform.editor`) + `roles/bigquery.jobUser`

**✅ เกณฑ์ผ่าน:** `gcloud iam service-accounts get-iam-policy $SA` เห็นทั้ง `tokenCreator` และ `serviceAccountUser` ของ service agent

> ⚠️ ตั้งแต่ 29/04/2026 Google บังคับ strict act-as ทั่วโลก — ใช้ Dataform service agent เป็นตัวรันไม่ได้แล้ว
> ทุก repository ต้องผูก custom SA เสมอ ถ้าเจอ `Permission denied to act as a service account` ให้กลับมาดูเฟสนี้

---

## Phase 1 · Seed dummy data เข้า BigQuery  ⏱ ~5 นาที

Dataform ทำแค่ T — ถ้าไม่มีตาราง bronze อยู่ก่อน `ref()` จะพังทันที

```bash
bq query --use_legacy_sql=false < "D:/OFM/test case dataform/seed/00_create_datasets.sql"
bq query --use_legacy_sql=false < "D:/OFM/test case dataform/seed/01_seed_bronze.sql"
```

**✅ เกณฑ์ผ่าน:** มี 9 dataset และนับแถวได้ทั้ง 6 ตาราง

```sql
SELECT table_name, row_count
FROM `ofm-b2s-data-dev.sbx_bronze.__TABLES_SUMMARY__`;   -- หรือ INFORMATION_SCHEMA.TABLES
```

---

## Phase 2 · สร้าง Repository + เชื่อม Git  ⏱ ~15 นาที

1. BigQuery console → **Dataform** → **Create repository**
   - Repository ID: `ofm-dataform-sandbox`
   - Region: **asia-southeast1** (region ของโค้ด — คนละเรื่องกับ `defaultLocation` ที่เป็น region ของการประมวลผล)
   - Service account: **`sa-dataform-dev@…`** ← ต้องเลือก ห้ามปล่อยว่าง
2. push โค้ดในโฟลเดอร์นี้ขึ้น Git remote (GitHub/GitLab) ที่ branch `main`
3. Repository → **Settings → Connect with Git provider** (ผ่าน Developer Connect) → ชี้ไปที่ remote นั้น branch `main`

```bash
cd "D:/OFM/test case dataform"
git init && git add . && git commit -m "Dataform sandbox: bronze/silver/gold + config ทุกชนิด"
git remote add origin <GIT_URL> && git push -u origin main
```

**✅ เกณฑ์ผ่าน:** หน้า repository เห็นไฟล์ครบ 44 ไฟล์และ branch เป็น `main`

> `.df-credentials.json` อยู่ใน `.gitignore` แล้ว — เช็คอีกรอบก่อน push ว่าไม่ติดไปด้วย

---

## Phase 3 · สร้าง Workspace + compile  ⏱ ~5 นาที

1. **Create development workspace** → ตั้งชื่อเป็นชื่อจริงตัวเอง (เช่น `chanwit`)
2. กด **Pull from default branch**
3. เปิด `workflow_settings.yaml` → ถ้าไม่ได้ใช้ project `ofm-b2s-data-dev` ให้แก้ `defaultProject`
   และ `vars.sourceProject` (2 ที่) แล้วแก้ในไฟล์ `seed/*.sql` ให้ตรงกันด้วย
4. (ไม่บังคับ) Repository → Settings → **Workspace compilation overrides** → Schema suffix `${workspaceName}`
   เพื่อให้ dev แต่ละคนเขียนคนละ dataset ไม่ทับกัน

**✅ เกณฑ์ผ่าน:** แถบบนขึ้น **Compiled 60 actions** ไม่มี compilation error

> repo นี้ **ไม่มี `package.json`** โดยตั้งใจ — repo ที่ใช้ `workflow_settings.yaml` ถ้ามีไฟล์นั้นจะ compile ไม่ผ่าน
> และไม่ต้องกด Install packages (core ถูกติดตั้งตอน runtime ตาม `dataformCoreVersion`)

---

## Phase 4 · รันด้วยมือครั้งแรก  ⏱ ~5 นาที

**Start execution → All actions** (ติ๊ก Include dependencies)

ลำดับที่ Dataform จะรันเอง: `dim_date` / declaration → cleansed → dimensions → conformed →
`assert_sales_freshness` → gold → assertion ของ gold → `purge` (เฉพาะรอบ monthly)

**✅ เกณฑ์ผ่าน:** เขียวครบทั้ง 60 actions รวม 38 assertion
ถ้า assertion ตกตั้งแต่รอบแรก ให้เปิด view ใน `sbx_dataform_assertions.<ชื่อ>` ดูว่าแถวไหนผิดก่อนแก้โค้ด

---

## Phase 5 · ทดสอบว่า assertion จับข้อมูลเสียได้จริง  ⏱ ~10 นาที

ขั้นนี้คือเหตุผลหลักที่ย้ายมา Dataform — ถ้าไม่ทดสอบ จะไม่รู้ว่ามันจับได้จริงไหม

```bash
bq query --use_legacy_sql=false < "seed/02_seed_bad_rows.sql"   # ใส่ข้อมูลเสีย 5 แบบ
# → Start execution → All actions  (ต้องมี assertion ล้ม 5 ตัว ตาม docs/test-cases.md TC-N1..N5)
bq query --use_legacy_sql=false < "seed/02b_undo_bad_rows.sql"  # ล้างกลับ
# → รันใหม่ + Run with full refresh เฉพาะตาราง incremental (TC-N6)
```

**✅ เกณฑ์ผ่าน:** ล้ม 5 ตัวตรงตามตาราง แล้วกลับมาเขียวได้หลังล้าง — ไม่ใช่ล้มมั่วหรือล้มไม่ครบ

---

## Phase 6 · Release + Workflow configuration (ตั้งเวลา)  ⏱ ~15 นาที

workspace **schedule ไม่ได้** ต้องผ่าน release config เสมอ

**Release configuration** — Repository → Releases & Scheduling → Create

| ช่อง | ค่า |
|---|---|
| Release ID | `sandbox` |
| Git commitish | `main` |
| Frequency | ทุก 24 ชม. · 04:00 |
| Compilation overrides → Project | `ofm-b2s-data-dev` |
| Compilation variables | `environment=sandbox` |

**Workflow configurations** — ทุกตัวเลือก release `sandbox`, service account `sa-dataform-dev`,
timezone **Asia/Bangkok**, ติ๊ก **Include dependencies**

| Configuration ID | Cron | ขอบเขต (tags) |
|---|---|---|
| `daily-silver-0500` | `0 5 * * *` | `daily` + `silver` |
| `daily-gold-0630` | `30 6 * * *` | `daily` + `gold` |
| `weekly-merch-mon-0300` | `0 3 * * 1` | `weekly` |
| `monthly-cleanup-0200` | `0 2 1 * *` | `monthly` |

**✅ เกณฑ์ผ่าน:** เช้าวันถัดไปเห็น workflow invocation ขึ้นเองในแท็บ Workflow execution logs

> **กฎ 1 ชั่วโมง:** เว้นอย่างน้อย 1 ชม. ระหว่างเวลา compile ของ release config (04:00) กับเวลารันแรก (05:00)
> ไม่งั้นเสี่ยงได้ compilation result เก่า
> **ถ้ารอบก่อนยังไม่จบ รอบถัดไปจะถูกข้ามและถูกทำเครื่องหมายเป็น error** — เว้นช่วงให้พอ

---

## Phase 7 · Alert + ส่งต่อให้ Airflow  ⏱ ~10 นาที

Dataform **ไม่มีระบบแจ้งเตือนในตัว** ถ้าไม่ตั้งข้อนี้ pipeline ล้มแบบเงียบ ๆ

Cloud Logging → Create log-based alert ด้วย filter:

```text
resource.type="dataform.googleapis.com/Repository"
jsonPayload.@type="type.googleapis.com/google.cloud.dataform.logging.v1.WorkflowInvocationCompletionLogEntry"
jsonPayload.terminalState="FAILED"
```

ถ้าต้องการให้ Airflow เป็นคนสั่ง (แนะนำเมื่อมี dependency กับ DAG ingestion อยู่แล้ว):
ใช้ [orchestration/dag_dataform_sandbox.py](../orchestration/dag_dataform_sandbox.py) —
ต้องใช้ `asynchronous=True` คู่กับ state sensor เสมอ ไม่งั้น task ขึ้นเขียวทั้งที่งานจริงล้มทีหลัง

**✅ เกณฑ์ผ่าน:** ทดลองทำให้ล้ม (เช่น seed 02 แล้วรัน) ต้องมีอีเมล/แจ้งเตือนเข้าจริง

---

## ลำดับการรันภายใน (Dataform จัดให้เองจาก `ref()`)

```
bronze (declaration)          silver                          gold
─────────────────────         ──────────────────────          ─────────────────────────
branch_master ──────────────→ dim_branch ──┬───────────────→ phms_branch_score
sap_material_master ────────→ slv_sap_material_master        ↑
                                   └──────→ dim_sku ─────┐   │
nexpos_sales_txn ───────────→ slv_nexpos_sales_txn ──┐   │   │
ecom_order_header ──────────→ slv_ecom_order_header ─┼─→ slv_sku_daily_sales
                                                      │        ├──→ sell_through_rate
nexpos_stock_movement ──────→ slv_nexpos_stock_movement       ├──→ abc_xyz_segment ←─ dim_sku
                                   └──────→ slv_stock_onhand_daily ──→ fact_cover_days
                              (+ dim_date)                     ├──→ mv_daily_sales_branch
planogram_slot ─────────────→ slv_planogram_slot ──────────→ phms_sku_health ─→ phms_branch_score
                              assert_sales_freshness ────────→ (บล็อก phms_branch_score)
                                                               revenue_daily_ofm / _b2s
```

`etl_run_log` (operations) ต้องรันก่อน `phms_sku_health` เพราะ post_operations เขียน log ลงไป
`purge_expired_partitions` รันท้ายสุดเฉพาะรอบ monthly

---

## 5 กับดักที่ทำให้เสียเงินหรือเสียข้อมูล (เช็คก่อนเอาแพตเทิร์นนี้ไปใช้กับของจริง)

1. `MERGE` ที่ไม่มี `updatePartitionFilter` → สแกนทั้งตารางทุกวัน
2. `onSchemaChange: "SYNCHRONIZE"` → คอลัมน์หายถาวร (repo นี้ใช้ `EXTEND` ทุกที่)
3. ตารางประวัติที่ไม่ใส่ `protected: true` → โดน full refresh แล้วข้อมูลย้อนหลังหาย
4. ไม่ตั้ง `defaultLocation` → งานไปตกที่ US multi-region
5. ไม่ตั้ง log-based alert → pipeline ล้มเงียบ ๆ
