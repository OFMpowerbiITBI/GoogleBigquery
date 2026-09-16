# Runbook — รัน / ตั้งเวลา / backfill sandbox นี้

## 1. รันจากเครื่องตัวเอง (Dataform CLI)

```bash
npm i -g @dataform/cli@3.0.50
dataform init-creds              # สร้าง .df-credentials.json (อยู่ใน .gitignore แล้ว ห้าม commit)

dataform compile                 # ดู SQL ที่ compile ได้ — ทำก่อนเสมอ
dataform compile --json > graph.json
dataform run --dry-run           # ให้ BigQuery ตรวจ SQL โดยยังไม่เขียนอะไร
dataform run                     # รันจริงทั้งหมด
```

รันเฉพาะบางส่วน (`--tags` / `--actions` รับค่าแบบ **เว้นวรรค** ไม่ใช่คั่นด้วย comma):

```bash
dataform run --actions slv_sku_daily_sales                 # ตัวเดียว
dataform run --actions slv_sku_daily_sales --include-deps  # ตัวเดียว + ต้นน้ำ
dataform run --tags daily silver                           # ตาม tag
dataform run --full-refresh --actions slv_ecom_order_header
dataform run --vars=environment=prod
```

> **2 เรื่องที่ทดสอบกับ CLI 3.0.50 แล้วและต่างจากตัวอย่างทั่วไปในคู่มือ**
> 1. repo ที่ใช้ `workflow_settings.yaml` **ต้องไม่มี `package.json`** — ถ้ามีจะ compile ไม่ผ่านทันที
>    (`'package.json' unexpected; remove it and try again`) เวอร์ชันของ core มาจาก `dataformCoreVersion` แทน
> 2. ด้วยเหตุผลเดียวกัน **ไม่ต้องรัน `dataform install`** — CLI จะตอบว่า
>    "No installation is needed when using workflow_settings.yaml, as packages are installed at runtime"
>
> และ `dataform test` **ไม่มี** ใน Dataform บน GCP — การทดสอบข้อมูลทำผ่าน assertion เท่านั้น
> (มี flag `--run-tests` อยู่ใน CLI แต่เป็นของ unit test แบบเก่าที่ไม่รองรับแล้ว)

## 2. รันจาก Dataform UI

| อยากทำ | ทำยังไง |
|---|---|
| ดู SQL ของไฟล์เดียว | เปิดไฟล์ → ปุ่ม **Run** (preview เท่านั้น ไม่เขียนตาราง) |
| รันทั้ง repo | **Start execution → All actions** |
| รันเฉพาะโดเมน | **Start execution → Selection of tags → `phms`** |
| backfill ย้อนหลัง | **Start execution → เลือก action → ติ๊ก Run with full refresh** |

⚠️ `slv_sap_material_master` จะถูกปฏิเสธเมื่อสั่ง full refresh เพราะตั้ง `protected: true` ไว้ — เป็นพฤติกรรมที่ตั้งใจ

## 3. tag ที่มีใน repo นี้

| มิติ | ค่าที่ใช้ |
|---|---|
| ความถี่ | `daily` · `weekly` · `monthly` |
| ชั้นข้อมูล | `silver` · `gold` · `utility` |
| โดเมน | `merchandise` · `supply_chain` · `phms` · `finance` · `marketing` · `master_data` · `ecommerce` · `data_quality` · `monitoring` · `maintenance` |
| BU | `ofm` · `b2s` (เฉพาะตารางที่แยกราย BU) |

ทุก action มี tag ครบ 3 มิติตามมาตรฐานทีม — ยกเว้น declaration ซึ่งไม่ถูกรันอยู่แล้ว

## 4. ตั้งเวลา (release + workflow configuration)

Dataform **schedule จาก workspace ไม่ได้** — ต้องผ่าน release config เสมอ

**Release configuration** (Repository → Releases & Scheduling → Release configurations → Create)

| ช่อง | ค่าที่ใช้กับ sandbox |
|---|---|
| Release ID | `sandbox` |
| Git commitish | `main` |
| Frequency | ทุก 24 ชม. เวลา 04:00 |
| Compilation overrides → Project ID | `ofm-b2s-data-dev` |
| Compilation variables | `environment=sandbox` |

ถ้าจะทำ production จริง ให้สร้างอีกตัว: `git commitish = prod`, project = `ofm-b2s-data-prod`,
vars `sourceProject=ofm-b2s-data-prod`, `sourceDataset=silver`
(อย่าลืมให้สิทธิ์ service account บน project ปลายทางด้วย)

**Workflow configurations** — ตารางเวลาที่เสนอ

| Configuration ID | Cron (Asia/Bangkok) | ขอบเขต | หมายเหตุ |
|---|---|---|---|
| `daily-silver-0500` | `0 5 * * *` | tags: `daily`, `silver` | หลัง ETL ต้นทางเสร็จ |
| `daily-gold-0630` | `30 6 * * *` | tags: `daily`, `gold` | ก่อน Power BI refresh 07:30 |
| `weekly-merch-mon-0300` | `0 3 * * 1` | tags: `weekly` | STR + ABC/XYZ ทุกวันจันทร์ |
| `monthly-cleanup-0200` | `0 2 1 * *` | tags: `monthly` | ลบข้อมูลเกินอายุ |

**กฎ 1 ชั่วโมง:** ต้องเว้นอย่างน้อย 1 ชม. ระหว่างเวลา compile ของ release config กับเวลารันของ workflow config
(compile 04:00 → รันเร็วสุด 05:00) ไม่งั้นเสี่ยงได้ compilation result เก่า

**เลือก Include dependencies** เสมอ เพื่อให้ตารางต้นน้ำที่ยังไม่ได้รันในรอบนั้นถูกรันให้ครบ

## 5. ให้ Airflow เป็นคนสั่ง

ดู [../orchestration/dag_dataform_sandbox.py](../orchestration/dag_dataform_sandbox.py)

สองเรื่องที่ต้องทำให้ถูก:
1. ใช้ `asynchronous=True` + `DataformWorkflowInvocationStateSensor` เสมอ
   ไม่งั้น task ใน Airflow จะขึ้นเขียวทันทีที่ "ส่งคำสั่งสำเร็จ" ทั้งที่งานจริงอาจล้มทีหลัง
2. ถ้าเลี่ยงได้ ให้เรียก live compilation result ของ release config แทนการ compile จาก git commitish ทุกรอบ
   (การ compile จาก commitish บังคับให้ Dataform clone repo ผ่าน network ทุกครั้ง)

## 6. Alert — Dataform ไม่มีระบบแจ้งเตือนในตัว

ต้องตั้ง log-based alert ใน Cloud Logging ด้วยตัวเอง:

```text
resource.type="dataform.googleapis.com/Repository"
jsonPayload.@type="type.googleapis.com/google.cloud.dataform.logging.v1.WorkflowInvocationCompletionLogEntry"
jsonPayload.terminalState="FAILED"
```

## 7. ตัวเลขข้อจำกัดที่ต้องจำ

| ของ | เพดาน |
|---|---|
| Action ต่อ repository | 5,000 |
| Dependency ต่อ action | 50 |
| Compiled graph | 20 MB |
| Compile CPU / wall time | 8 วินาที / 30 วินาที |
| ประวัติการรันที่เก็บไว้ | 90 วัน |
| ช่วงห่าง compile → run | ≥ 1 ชั่วโมง |

## 8. ปัญหาที่เจอบ่อยใน sandbox นี้

| อาการ | สาเหตุที่น่าจะเป็น | แก้ยังไง |
|---|---|---|
| `Table not found: sbx_bronze.*` | ยังไม่ได้รัน seed หรือรันคนละ project | รัน `seed/00` + `seed/01` ใน project เดียวกับ `workflow_settings.yaml` |
| `MERGE must match at most one source row` | source มี key ซ้ำในรอบเดียว | ต้องมี `QUALIFY ... ROW_NUMBER() = 1` ก่อน MERGE (ดู `slv_ecom_order_header`) |
| assertion `uniqueKey` ล้มทั้งที่ข้อมูลดูปกติ | ต้นทางส่งแถวซ้ำจริง | เปิด view ใน `sbx_dataform_assertions` ดูว่าซ้ำที่คีย์ไหน |
| full refresh ถูกปฏิเสธ | ตารางตั้ง `protected: true` | ตั้งใจให้เป็นแบบนั้น — ถ้าจำเป็นจริงต้องเอา flag ออกชั่วคราวและรู้ว่ากำลังลบประวัติ |
| MV สร้างไม่ผ่าน | base เป็น view หรือมี JOIN | MV ของ BigQuery อ้างได้ทีละตารางเดียว ห้าม JOIN |
| บิล BigQuery พุ่งหลังเพิ่ม incremental | ลืม `updatePartitionFilter` | เพิ่มเข้าไปแล้ว full refresh หนึ่งรอบ |
