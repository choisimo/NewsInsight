"""
Audit Service - 감사 로그 관리 서비스
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from ..models.schemas import AuditAction, AuditLog, AuditLogFilter


class AuditService:
    """감사 로그 서비스"""

    def __init__(self, config_dir: str, max_logs: int = 10000):
        self.config_dir = Path(config_dir)
        self.logs_file = self.config_dir / "audit_logs.jsonl"
        self.max_logs = max_logs
        self._ensure_log_file()

    def _ensure_log_file(self) -> None:
        """로그 파일 존재 확인"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        if not self.logs_file.exists():
            self.logs_file.touch()

    def log(
        self,
        user_id: str,
        username: str,
        action: AuditAction,
        resource_type: str,
        resource_id: Optional[str] = None,
        resource_name: Optional[str] = None,
        environment_id: Optional[str] = None,
        environment_name: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        success: bool = True,
        error_message: Optional[str] = None,
    ) -> AuditLog:
        """감사 로그 기록"""
        log_entry = AuditLog(
            id=f"audit-{uuid4().hex[:12]}",
            user_id=user_id,
            username=username,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=resource_name,
            environment_id=environment_id,
            environment_name=environment_name,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            timestamp=datetime.utcnow(),
            success=success,
            error_message=error_message,
        )

        # JSONL 형식으로 저장
        with open(self.logs_file, "a") as f:
            f.write(log_entry.model_dump_json() + "\n")

        # 로그 파일 크기 관리
        self._rotate_if_needed()

        return log_entry

    def _rotate_if_needed(self) -> None:
        """로그 파일 크기 관리"""
        try:
            with open(self.logs_file, "r") as f:
                lines = f.readlines()

            if len(lines) > self.max_logs:
                # 오래된 로그 삭제 (최신 max_logs개만 유지)
                with open(self.logs_file, "w") as f:
                    f.writelines(lines[-self.max_logs :])
        except Exception:
            pass

    def get_logs(
        self,
        filter_params: Optional[AuditLogFilter] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AuditLog], int]:
        """감사 로그 조회"""
        logs = []

        try:
            with open(self.logs_file, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            log = AuditLog(**data)
                            logs.append(log)
                        except (json.JSONDecodeError, Exception):
                            continue
        except FileNotFoundError:
            return [], 0

        # 필터 적용
        if filter_params:
            logs = self._apply_filter(logs, filter_params)

        # 최신순 정렬
        logs.sort(key=lambda x: x.timestamp, reverse=True)

        total = len(logs)

        # 페이지네이션
        start = (page - 1) * page_size
        end = start + page_size
        paginated_logs = logs[start:end]

        return paginated_logs, total

    def _apply_filter(
        self, logs: list[AuditLog], filter_params: AuditLogFilter
    ) -> list[AuditLog]:
        """필터 적용"""
        filtered = logs

        if filter_params.user_id:
            filtered = [l for l in filtered if l.user_id == filter_params.user_id]

        if filter_params.action:
            filtered = [l for l in filtered if l.action == filter_params.action]

        if filter_params.resource_type:
            filtered = [
                l for l in filtered if l.resource_type == filter_params.resource_type
            ]

        if filter_params.environment_id:
            filtered = [
                l for l in filtered if l.environment_id == filter_params.environment_id
            ]

        if filter_params.start_date:
            filtered = [
                l for l in filtered if l.timestamp >= filter_params.start_date
            ]

        if filter_params.end_date:
            filtered = [l for l in filtered if l.timestamp <= filter_params.end_date]

        if filter_params.success is not None:
            filtered = [l for l in filtered if l.success == filter_params.success]

        return filtered

    def get_log_by_id(self, log_id: str) -> Optional[AuditLog]:
        """특정 로그 조회"""
        try:
            with open(self.logs_file, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            if data.get("id") == log_id:
                                return AuditLog(**data)
                        except (json.JSONDecodeError, Exception):
                            continue
        except FileNotFoundError:
            pass

        return None

    def get_user_activity(
        self, user_id: str, limit: int = 100
    ) -> list[AuditLog]:
        """사용자 활동 이력 조회"""
        logs, _ = self.get_logs(
            filter_params=AuditLogFilter(user_id=user_id),
            page=1,
            page_size=limit,
        )
        return logs

    def get_resource_history(
        self, resource_type: str, resource_id: str, limit: int = 100
    ) -> list[AuditLog]:
        """리소스 변경 이력 조회"""
        logs = []

        try:
            with open(self.logs_file, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            if (
                                data.get("resource_type") == resource_type
                                and data.get("resource_id") == resource_id
                            ):
                                logs.append(AuditLog(**data))
                        except (json.JSONDecodeError, Exception):
                            continue
        except FileNotFoundError:
            pass

        logs.sort(key=lambda x: x.timestamp, reverse=True)
        return logs[:limit]

    def get_statistics(
        self, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None
    ) -> dict[str, Any]:
        """감사 로그 통계"""
        logs, total = self.get_logs(
            filter_params=AuditLogFilter(start_date=start_date, end_date=end_date),
            page=1,
            page_size=self.max_logs,
        )

        # 액션별 통계
        action_counts = {}
        for log in logs:
            action = log.action.value
            action_counts[action] = action_counts.get(action, 0) + 1

        # 사용자별 통계
        user_counts = {}
        for log in logs:
            user = log.username
            user_counts[user] = user_counts.get(user, 0) + 1

        # 리소스 타입별 통계
        resource_counts = {}
        for log in logs:
            resource = log.resource_type
            resource_counts[resource] = resource_counts.get(resource, 0) + 1

        # 성공/실패 통계
        success_count = sum(1 for l in logs if l.success)
        failure_count = total - success_count

        return {
            "total_logs": total,
            "action_counts": action_counts,
            "user_counts": user_counts,
            "resource_counts": resource_counts,
            "success_count": success_count,
            "failure_count": failure_count,
        }

    def clear_old_logs(self, days: int = 90) -> int:
        """오래된 로그 삭제"""
        cutoff = datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        from datetime import timedelta

        cutoff = cutoff - timedelta(days=days)

        kept_logs = []
        deleted_count = 0

        try:
            with open(self.logs_file, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            log_time = datetime.fromisoformat(
                                data.get("timestamp", "").replace("Z", "+00:00")
                            )
                            if log_time >= cutoff:
                                kept_logs.append(line)
                            else:
                                deleted_count += 1
                        except (json.JSONDecodeError, Exception):
                            kept_logs.append(line)

            with open(self.logs_file, "w") as f:
                f.writelines(kept_logs)

        except FileNotFoundError:
            pass

        return deleted_count
