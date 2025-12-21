"""
Script Service - 스크립트/작업 관리 및 실행 서비스
"""
import asyncio
import os
import re
import signal
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Optional
from uuid import uuid4

import yaml

from ..models.schemas import (
    RiskLevel,
    Script,
    ScriptCreate,
    ScriptParameter,
    ScriptUpdate,
    TaskExecution,
    TaskLog,
    TaskStatus,
    UserRole,
)


# ============================================================================
# 보안: 위험 명령어 필터링
# ============================================================================

# 절대 허용하지 않는 위험한 명령어 패턴들
DANGEROUS_COMMAND_PATTERNS = [
    # 시스템 파괴 명령어
    r'\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?/\s*$',  # rm -rf /
    r'\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?/\s*$',  # rm -fr /
    r'\brm\s+-[a-zA-Z]*\s+/\s*$',  # rm -* /
    r'\brm\s+--no-preserve-root',  # rm --no-preserve-root
    r':\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;',  # fork bomb :(){ :|:& };:
    r'\bdd\s+.*of=/dev/(sd[a-z]|hd[a-z]|nvme)',  # dd to disk devices
    r'\bmkfs\s+',  # format filesystem
    r'\bfdisk\s+',  # partition table manipulation
    r'\bparted\s+',  # partition manipulation
    
    # 위험한 경로 삭제
    r'\brm\s+.*\s+/boot\b',
    r'\brm\s+.*\s+/etc\b',
    r'\brm\s+.*\s+/usr\b',
    r'\brm\s+.*\s+/bin\b',
    r'\brm\s+.*\s+/sbin\b',
    r'\brm\s+.*\s+/lib\b',
    r'\brm\s+.*\s+/var\b',
    r'\brm\s+.*\s+/home\b',
    r'\brm\s+.*\s+/root\b',
    r'\brm\s+.*\s+/sys\b',
    r'\brm\s+.*\s+/proc\b',
    r'\brm\s+.*\s+/dev\b',
    
    # 권한 상승 및 보안 우회
    r'\bchmod\s+777\s+/',  # chmod 777 /
    r'\bchmod\s+-R\s+777\s+/',  # chmod -R 777 /
    r'\bchown\s+-R\s+.*:.*\s+/',  # chown -R on root
    
    # 네트워크 공격 관련
    r'\bnc\s+-[a-zA-Z]*e',  # netcat with execute
    r'\bcurl\s+.*\|\s*(ba)?sh',  # curl pipe to shell
    r'\bwget\s+.*\|\s*(ba)?sh',  # wget pipe to shell
    
    # 암호화폐 채굴 등 악용 가능 패턴
    r'\b(xmrig|minerd|cgminer|bfgminer)\b',
    
    # 시스템 종료/재부팅
    r'\bshutdown\b',
    r'\breboot\b',
    r'\bhalt\b',
    r'\bpoweroff\b',
    r'\binit\s+[06]\b',
    
    # 사용자/패스워드 조작
    r'\bpasswd\s+root\b',
    r'\busermod\s+-[a-zA-Z]*\s+root\b',
    r'\buserdel\s+',
    r'\bgroupdel\s+',
    
    # 위험한 환경변수 조작
    r'\bexport\s+PATH=\s*$',  # PATH 비우기
    r'\bexport\s+LD_PRELOAD=',  # LD_PRELOAD 조작
    
    # 시스템 로그 삭제
    r'\brm\s+.*(/var/log|\.log)',
    r'>\s*/var/log/',
    r'\btruncate\s+.*(/var/log|\.log)',
]

# 위험 키워드 (sudo와 함께 사용 시 추가 경고)
DANGEROUS_WITH_SUDO = [
    r'\bsudo\s+rm\s+-[a-zA-Z]*r',
    r'\bsudo\s+rm\s+/',
    r'\bsudo\s+dd\b',
    r'\bsudo\s+mkfs\b',
    r'\bsudo\s+fdisk\b',
]


class CommandSecurityError(Exception):
    """명령어 보안 검사 실패 예외"""
    def __init__(self, command: str, reason: str, pattern: str = None):
        self.command = command
        self.reason = reason
        self.pattern = pattern
        super().__init__(f"Security violation: {reason}")


def validate_command_security(command: str) -> tuple[bool, str]:
    """
    명령어 보안 검사
    
    Args:
        command: 실행할 명령어
        
    Returns:
        (is_safe, reason): 안전 여부와 이유
        
    Raises:
        CommandSecurityError: 위험한 명령어 감지 시
    """
    # 명령어 정규화 (소문자 변환, 연속 공백 제거)
    normalized = ' '.join(command.lower().split())
    
    # 위험 패턴 검사
    for pattern in DANGEROUS_COMMAND_PATTERNS:
        if re.search(pattern, normalized, re.IGNORECASE):
            raise CommandSecurityError(
                command=command,
                reason=f"위험한 명령어 패턴이 감지되었습니다: 시스템 보안을 위해 이 명령어는 실행할 수 없습니다.",
                pattern=pattern
            )
    
    # sudo + 위험 명령어 조합 검사
    for pattern in DANGEROUS_WITH_SUDO:
        if re.search(pattern, normalized, re.IGNORECASE):
            raise CommandSecurityError(
                command=command,
                reason=f"sudo와 함께 사용된 위험한 명령어가 감지되었습니다. 시스템 보호를 위해 차단됩니다.",
                pattern=pattern
            )
    
    return True, "OK"


class ScriptService:
    """스크립트 관리 및 실행 서비스"""

    def __init__(self, project_root: str, config_dir: str):
        self.project_root = Path(project_root)
        self.config_dir = Path(config_dir)
        self.scripts: dict[str, Script] = {}
        self.executions: dict[str, TaskExecution] = {}
        self.running_processes: dict[str, subprocess.Popen] = {}
        self._load_scripts()

    def _load_scripts(self) -> None:
        """설정 파일에서 스크립트 정보 로드"""
        config_file = self.config_dir / "scripts.yaml"
        if config_file.exists():
            with open(config_file) as f:
                data = yaml.safe_load(f) or {}
                for script_data in data.get("scripts", []):
                    # parameters를 ScriptParameter 객체로 변환
                    if "parameters" in script_data:
                        script_data["parameters"] = [
                            ScriptParameter(**p) if isinstance(p, dict) else p
                            for p in script_data["parameters"]
                        ]
                    script = Script(**script_data)
                    self.scripts[script.id] = script
        else:
            self._create_default_scripts()

    def _create_default_scripts(self) -> None:
        """기본 스크립트 설정 생성"""
        scripts_dir = self.project_root / "scripts"
        now = datetime.utcnow()

        default_scripts = [
            {
                "id": "script-start",
                "name": "서비스 시작",
                "description": "선택한 환경의 Docker Compose 서비스를 시작합니다.",
                "command": "docker compose -f {compose_file} -p newsinsight up -d",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.LOW,
                "estimated_duration": 120,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.OPERATOR,
                "parameters": [
                    ScriptParameter(
                        name="build",
                        param_type="boolean",
                        required=False,
                        default=True,
                        description="이미지 빌드 여부",
                    ),
                ],
                "tags": ["docker", "deploy"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-stop",
                "name": "서비스 중지",
                "description": "선택한 환경의 Docker Compose 서비스를 중지합니다.",
                "command": "docker compose -f {compose_file} -p newsinsight down",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.MEDIUM,
                "estimated_duration": 60,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.OPERATOR,
                "parameters": [],
                "tags": ["docker", "stop"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-restart",
                "name": "서비스 재시작",
                "description": "선택한 환경의 Docker Compose 서비스를 재시작합니다.",
                "command": "docker compose -f {compose_file} -p newsinsight restart {service}",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.MEDIUM,
                "estimated_duration": 60,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.OPERATOR,
                "parameters": [
                    ScriptParameter(
                        name="service",
                        param_type="string",
                        required=False,
                        default="",
                        description="재시작할 서비스 이름 (비워두면 전체 재시작)",
                    ),
                ],
                "tags": ["docker", "restart"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-full-cleanup",
                "name": "전체 정리 (Full Cleanup)",
                "description": "컨테이너, 볼륨, 이미지, 캐시를 모두 정리합니다. ⚠️ 데이터베이스 볼륨도 삭제됩니다!",
                "command": """docker compose -f {compose_file} -p newsinsight down -v && \
docker builder prune -f && \
docker image prune -f && \
docker volume prune -f""",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.CRITICAL,
                "estimated_duration": 180,
                "allowed_environments": ["local", "staging"],
                "required_role": UserRole.ADMIN,
                "parameters": [],
                "tags": ["docker", "cleanup", "dangerous"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-status",
                "name": "서비스 상태 확인",
                "description": "현재 실행 중인 컨테이너 상태를 확인합니다.",
                "command": "docker compose -f {compose_file} -p newsinsight ps -a",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.LOW,
                "estimated_duration": 5,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.VIEWER,
                "parameters": [],
                "tags": ["docker", "status"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-logs",
                "name": "서비스 로그 조회",
                "description": "특정 서비스의 로그를 조회합니다.",
                "command": "docker compose -f {compose_file} -p newsinsight logs --tail {tail} {service}",
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.LOW,
                "estimated_duration": 10,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.VIEWER,
                "parameters": [
                    ScriptParameter(
                        name="service",
                        param_type="string",
                        required=True,
                        description="로그를 조회할 서비스 이름",
                    ),
                    ScriptParameter(
                        name="tail",
                        param_type="number",
                        required=False,
                        default=100,
                        description="출력할 로그 줄 수",
                    ),
                ],
                "tags": ["docker", "logs"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-build-push",
                "name": "이미지 빌드 및 푸시",
                "description": "Docker 이미지를 빌드하고 레지스트리에 푸시합니다.",
                "command": str(scripts_dir / "build-and-push.sh"),
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.MEDIUM,
                "estimated_duration": 300,
                "allowed_environments": ["production", "staging"],
                "required_role": UserRole.OPERATOR,
                "parameters": [
                    ScriptParameter(
                        name="tag",
                        param_type="string",
                        required=False,
                        default="latest",
                        description="이미지 태그",
                    ),
                ],
                "tags": ["docker", "build", "ci"],
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "script-health-check",
                "name": "헬스체크",
                "description": "모든 서비스의 헬스 상태를 확인합니다.",
                "command": """docker compose -f {compose_file} -p newsinsight ps --format json | \
python3 -c "import sys,json; [print(f'{json.loads(l).get(\"Name\")}: {json.loads(l).get(\"Health\", \"N/A\")}') for l in sys.stdin if l.strip()]" """,
                "working_dir": str(self.project_root),
                "risk_level": RiskLevel.LOW,
                "estimated_duration": 10,
                "allowed_environments": ["zerotrust", "local", "production", "staging"],
                "required_role": UserRole.VIEWER,
                "parameters": [],
                "tags": ["health", "monitoring"],
                "created_at": now,
                "updated_at": now,
            },
        ]

        for script_data in default_scripts:
            script = Script(**script_data)
            self.scripts[script.id] = script

        self._save_scripts()

    def _save_scripts(self) -> None:
        """스크립트 설정을 파일에 저장"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        config_file = self.config_dir / "scripts.yaml"

        data = {
            "scripts": [
                script.model_dump(mode="json") for script in self.scripts.values()
            ]
        }

        with open(config_file, "w") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    def list_scripts(
        self,
        environment: Optional[str] = None,
        tag: Optional[str] = None,
        role: Optional[UserRole] = None,
    ) -> list[Script]:
        """스크립트 목록 조회"""
        scripts = list(self.scripts.values())

        if environment:
            scripts = [
                s
                for s in scripts
                if not s.allowed_environments or environment in s.allowed_environments
            ]

        if tag:
            scripts = [s for s in scripts if tag in s.tags]

        if role:
            role_priority = {UserRole.VIEWER: 0, UserRole.OPERATOR: 1, UserRole.ADMIN: 2}
            user_level = role_priority.get(role, 0)
            scripts = [
                s for s in scripts if role_priority.get(s.required_role, 0) <= user_level
            ]

        return scripts

    def get_script(self, script_id: str) -> Optional[Script]:
        """스크립트 상세 조회"""
        return self.scripts.get(script_id)

    def create_script(self, data: ScriptCreate) -> Script:
        """스크립트 생성"""
        script_id = f"script-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        script = Script(
            id=script_id,
            created_at=now,
            updated_at=now,
            **data.model_dump(),
        )

        self.scripts[script_id] = script
        self._save_scripts()
        return script

    def update_script(self, script_id: str, data: ScriptUpdate) -> Optional[Script]:
        """스크립트 수정"""
        script = self.scripts.get(script_id)
        if not script:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(script, key, value)

        script.updated_at = datetime.utcnow()
        self._save_scripts()
        return script

    def delete_script(self, script_id: str) -> bool:
        """스크립트 삭제"""
        if script_id in self.scripts:
            del self.scripts[script_id]
            self._save_scripts()
            return True
        return False

    async def execute_script(
        self,
        script_id: str,
        environment_name: str,
        compose_file: str,
        parameters: dict[str, Any],
        executed_by: str,
    ) -> TaskExecution:
        """스크립트 실행"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError(f"Script not found: {script_id}")

        execution_id = f"exec-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        # 명령어 템플릿 치환
        command = script.command.format(
            compose_file=compose_file,
            **parameters,
        )
        
        # 보안 검사: 위험한 명령어 차단
        try:
            validate_command_security(command)
        except CommandSecurityError as e:
            raise ValueError(f"보안 위반: {e.reason}")

        execution = TaskExecution(
            id=execution_id,
            script_id=script_id,
            script_name=script.name,
            environment_id=environment_name,
            environment_name=environment_name,
            status=TaskStatus.RUNNING,
            parameters=parameters,
            started_at=now,
            executed_by=executed_by,
        )

        self.executions[execution_id] = execution

        # 비동기로 실행
        asyncio.create_task(
            self._run_command(execution_id, command, script.working_dir)
        )

        return execution

    async def _run_command(
        self, execution_id: str, command: str, working_dir: Optional[str]
    ) -> None:
        """명령어 실행 (비동기)"""
        execution = self.executions.get(execution_id)
        if not execution:
            return

        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=working_dir,
            )

            self.running_processes[execution_id] = process

            # 출력 수집
            stdout, _ = await process.communicate()

            execution.exit_code = process.returncode
            execution.status = (
                TaskStatus.SUCCESS if process.returncode == 0 else TaskStatus.FAILED
            )
            execution.finished_at = datetime.utcnow()

            if process.returncode != 0:
                execution.error_message = stdout.decode() if stdout else "Unknown error"

        except Exception as e:
            execution.status = TaskStatus.FAILED
            execution.error_message = str(e)
            execution.finished_at = datetime.utcnow()
        finally:
            if execution_id in self.running_processes:
                del self.running_processes[execution_id]

    async def stream_execution_output(
        self,
        script_id: str,
        environment_name: str,
        compose_file: str,
        parameters: dict[str, Any],
        executed_by: str,
    ) -> AsyncGenerator[str, None]:
        """스크립트 실행 및 출력 스트리밍"""
        script = self.scripts.get(script_id)
        if not script:
            yield f"Error: Script not found: {script_id}\n"
            return

        execution_id = f"exec-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        # 명령어 템플릿 치환
        command = script.command.format(
            compose_file=compose_file,
            **parameters,
        )
        
        # 보안 검사: 위험한 명령어 차단
        try:
            validate_command_security(command)
        except CommandSecurityError as e:
            yield f"[SECURITY ERROR] {e.reason}\n"
            yield f"[BLOCKED] 명령어가 보안 정책에 의해 차단되었습니다.\n"
            return

        execution = TaskExecution(
            id=execution_id,
            script_id=script_id,
            script_name=script.name,
            environment_id=environment_name,
            environment_name=environment_name,
            status=TaskStatus.RUNNING,
            parameters=parameters,
            started_at=now,
            executed_by=executed_by,
        )

        self.executions[execution_id] = execution

        yield f"[{now.isoformat()}] Starting: {script.name}\n"
        yield f"[{now.isoformat()}] Command: {command}\n"
        yield f"[{now.isoformat()}] Working dir: {script.working_dir}\n"
        yield "-" * 60 + "\n"

        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=script.working_dir,
            )

            self.running_processes[execution_id] = process

            # 실시간 출력 스트리밍
            async for line in process.stdout:
                yield line.decode()

            await process.wait()

            execution.exit_code = process.returncode
            execution.status = (
                TaskStatus.SUCCESS if process.returncode == 0 else TaskStatus.FAILED
            )
            execution.finished_at = datetime.utcnow()

            yield "-" * 60 + "\n"
            yield f"[{execution.finished_at.isoformat()}] Finished with exit code: {process.returncode}\n"
            yield f"[{execution.finished_at.isoformat()}] Status: {execution.status.value}\n"

        except Exception as e:
            execution.status = TaskStatus.FAILED
            execution.error_message = str(e)
            execution.finished_at = datetime.utcnow()
            yield f"[ERROR] {str(e)}\n"
        finally:
            if execution_id in self.running_processes:
                del self.running_processes[execution_id]

    def cancel_execution(self, execution_id: str) -> bool:
        """실행 중인 작업 취소"""
        process = self.running_processes.get(execution_id)
        if process:
            try:
                process.terminate()
                execution = self.executions.get(execution_id)
                if execution:
                    execution.status = TaskStatus.CANCELLED
                    execution.finished_at = datetime.utcnow()
                return True
            except Exception:
                return False
        return False

    def get_execution(self, execution_id: str) -> Optional[TaskExecution]:
        """실행 정보 조회"""
        return self.executions.get(execution_id)

    def list_executions(
        self,
        script_id: Optional[str] = None,
        environment_id: Optional[str] = None,
        status: Optional[TaskStatus] = None,
        limit: int = 50,
    ) -> list[TaskExecution]:
        """실행 이력 조회"""
        executions = list(self.executions.values())

        if script_id:
            executions = [e for e in executions if e.script_id == script_id]

        if environment_id:
            executions = [e for e in executions if e.environment_id == environment_id]

        if status:
            executions = [e for e in executions if e.status == status]

        # 최신순 정렬
        executions.sort(key=lambda x: x.started_at, reverse=True)

        return executions[:limit]
