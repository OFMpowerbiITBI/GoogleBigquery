"""
dags/dag_dataform_sandbox.py

ตัวอย่างให้ Airflow (Cloud Composer) เป็นคนสั่ง Dataform sandbox
— Airflow คุม pipeline ระดับองค์กร (รอไฟล์ vendor, ดึงข้อมูลเข้า bronze, สั่ง Power BI refresh)
— Dataform รับผิดชอบเฉพาะช่วง transform ภายใน BigQuery

ต้องมีก่อนใช้:
  - ติดตั้ง PyPI package `google-cloud-dataform` บน Composer environment
  - service account ของ Composer ต้องมีสิทธิ์ Dataform (dataform.editor ขึ้นไป)

สองเรื่องที่ห้ามพลาด:
  1. ใช้ asynchronous=True คู่กับ state sensor เสมอ ไม่งั้น task จะขึ้นเขียวทันทีที่ส่งคำสั่งสำเร็จ
     ทั้งที่งานจริงอาจล้มทีหลัง
  2. Google แนะนำให้เรียก live compilation result ของ release config แทนการ compile จาก
     git commitish ทุกรอบ (compile จาก commitish บังคับ clone repo ผ่าน network ทุกครั้ง)
     ตัวอย่างนี้ compile จาก commitish เพื่อให้เห็นครบทั้ง 3 ขั้น — ถ้าใช้จริงให้เว้นระยะ cron
     และตั้ง retry แบบ exponential backoff
"""

from datetime import datetime, timedelta

from airflow import models
from airflow.providers.google.cloud.operators.dataform import (
    DataformCreateCompilationResultOperator,
    DataformCreateWorkflowInvocationOperator,
)
from airflow.providers.google.cloud.sensors.dataform import (
    DataformWorkflowInvocationStateSensor,
)
from google.cloud.dataform_v1 import WorkflowInvocation

PROJECT_ID = "ofm-b2s-data-dev"
REPOSITORY_ID = "ofm-dataform-sandbox"
REGION = "asia-southeast1"
GIT_COMMITISH = "main"

default_args = {
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
}

with models.DAG(
    dag_id="dataform_sandbox_daily",
    # 06:30 เวลาไทย — หลัง ETL ชั้น bronze เสร็จ และก่อน Power BI refresh
    schedule="30 6 * * *",
    start_date=datetime(2026, 9, 1),
    catchup=False,
    default_args=default_args,
    tags=["dataform", "sandbox", "gold"],
    doc_md=__doc__,
) as dag:

    create_compilation_result = DataformCreateCompilationResultOperator(
        task_id="create_compilation_result",
        project_id=PROJECT_ID,
        region=REGION,
        repository_id=REPOSITORY_ID,
        compilation_result={
            "git_commitish": GIT_COMMITISH,
            # override ค่าเดียวกับที่ release config ใช้ เพื่อให้ผลลัพธ์เหมือนกันทุกช่องทาง
            "code_compilation_config": {
                "default_database": PROJECT_ID,
                "vars": {"environment": "sandbox"},
            },
        },
    )

    run_silver = DataformCreateWorkflowInvocationOperator(
        task_id="run_silver",
        project_id=PROJECT_ID,
        region=REGION,
        repository_id=REPOSITORY_ID,
        asynchronous=True,
        workflow_invocation={
            "compilation_result": (
                "{{ task_instance.xcom_pull('create_compilation_result')['name'] }}"
            ),
            "invocation_config": {
                "included_tags": ["daily", "silver"],
                "transitive_dependencies_included": True,
            },
        },
    )

    wait_silver = DataformWorkflowInvocationStateSensor(
        task_id="wait_silver",
        project_id=PROJECT_ID,
        region=REGION,
        repository_id=REPOSITORY_ID,
        workflow_invocation_id=(
            "{{ task_instance.xcom_pull('run_silver')['name'].split('/')[-1] }}"
        ),
        expected_statuses={WorkflowInvocation.State.SUCCEEDED},
        failure_statuses={WorkflowInvocation.State.FAILED, WorkflowInvocation.State.CANCELLED},
        poke_interval=60,
        timeout=60 * 60,
    )

    run_gold = DataformCreateWorkflowInvocationOperator(
        task_id="run_gold",
        project_id=PROJECT_ID,
        region=REGION,
        repository_id=REPOSITORY_ID,
        asynchronous=True,
        workflow_invocation={
            "compilation_result": (
                "{{ task_instance.xcom_pull('create_compilation_result')['name'] }}"
            ),
            "invocation_config": {
                "included_tags": ["daily", "gold"],
                "transitive_dependencies_included": True,
            },
        },
    )

    wait_gold = DataformWorkflowInvocationStateSensor(
        task_id="wait_gold",
        project_id=PROJECT_ID,
        region=REGION,
        repository_id=REPOSITORY_ID,
        workflow_invocation_id=(
            "{{ task_instance.xcom_pull('run_gold')['name'].split('/')[-1] }}"
        ),
        expected_statuses={WorkflowInvocation.State.SUCCEEDED},
        failure_statuses={WorkflowInvocation.State.FAILED, WorkflowInvocation.State.CANCELLED},
        poke_interval=60,
        timeout=60 * 60,
    )

    # แยก silver กับ gold เป็นคนละ invocation เพื่อให้เห็นชัดว่าล้มที่ชั้นไหน
    # และถ้า silver ล้ม gold จะไม่ถูกสั่งรันด้วยข้อมูลค้าง
    create_compilation_result >> run_silver >> wait_silver >> run_gold >> wait_gold
