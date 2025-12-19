"""
Auth Service - 인증/권한 관리 서비스
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yaml
from jose import JWTError, jwt

from ..models.schemas import Token, TokenData, User, UserCreate, UserRole, SetupStatus


class AuthService:
    """인증/권한 서비스"""

    def __init__(
        self,
        config_dir: str,
        secret_key: Optional[str] = None,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = 60,
    ):
        self.config_dir = Path(config_dir)
        self.secret_key = secret_key or secrets.token_urlsafe(32)
        self.algorithm = algorithm
        self.access_token_expire_minutes = access_token_expire_minutes
        self.users: dict[str, dict] = {}  # user_id -> user_data (with password hash)
        self._load_users()

    def _load_users(self) -> None:
        """사용자 정보 로드"""
        users_file = self.config_dir / "users.yaml"
        if users_file.exists():
            with open(users_file) as f:
                data = yaml.safe_load(f) or {}
                self.users = data.get("users", {})
        else:
            # 기본 관리자 계정 생성
            self._create_default_admin()

    def _create_default_admin(self) -> None:
        """기본 관리자 계정 생성"""
        admin_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        # 기본 비밀번호: admin123 (운영 시 반드시 변경!)
        password_hash = self._hash_password("admin123")

        self.users[admin_id] = {
            "id": admin_id,
            "username": "admin",
            "email": "admin@localhost",
            "password_hash": password_hash,
            "role": UserRole.ADMIN.value,
            "is_active": True,
            "created_at": now.isoformat(),
            "last_login": None,
            "password_change_required": True,  # 초기 설정 시 비밀번호 변경 필요
        }

        self._save_users()

    def _save_users(self) -> None:
        """사용자 정보 저장"""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        users_file = self.config_dir / "users.yaml"

        data = {"users": self.users}

        with open(users_file, "w") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    def _hash_password(self, password: str) -> str:
        """비밀번호 해시"""
        # 실제 운영에서는 bcrypt 등 사용 권장
        return hashlib.sha256(password.encode()).hexdigest()

    def _verify_password(self, password: str, password_hash: str) -> bool:
        """비밀번호 검증"""
        return self._hash_password(password) == password_hash

    def authenticate(self, username: str, password: str) -> Optional[User]:
        """사용자 인증"""
        for user_data in self.users.values():
            if user_data.get("username") == username:
                if not user_data.get("is_active", False):
                    return None

                if self._verify_password(password, user_data.get("password_hash", "")):
                    # 마지막 로그인 시간 업데이트
                    user_data["last_login"] = datetime.utcnow().isoformat()
                    self._save_users()

                    return User(
                        id=user_data["id"],
                        username=user_data["username"],
                        email=user_data.get("email"),
                        role=UserRole(user_data["role"]),
                        is_active=user_data["is_active"],
                        created_at=datetime.fromisoformat(user_data["created_at"]),
                        last_login=datetime.fromisoformat(user_data["last_login"])
                        if user_data.get("last_login")
                        else None,
                        password_change_required=user_data.get(
                            "password_change_required", False
                        ),
                    )

        return None

    def create_access_token(self, user: User) -> Token:
        """액세스 토큰 생성"""
        expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)

        payload = {
            "sub": user.id,
            "username": user.username,
            "role": user.role.value,
            "exp": expire,
        }

        token = jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

        return Token(
            access_token=token,
            token_type="bearer",
            expires_in=self.access_token_expire_minutes * 60,
        )

    def verify_token(self, token: str) -> Optional[TokenData]:
        """토큰 검증"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])

            user_id = payload.get("sub")
            username = payload.get("username")
            role = payload.get("role")
            exp = payload.get("exp")

            if not all([user_id, username, role, exp]):
                return None

            return TokenData(
                user_id=user_id,
                username=username,
                role=UserRole(role),
                exp=datetime.fromtimestamp(exp),
            )

        except JWTError:
            return None

    def get_user(self, user_id: str) -> Optional[User]:
        """사용자 조회"""
        user_data = self.users.get(user_id)
        if not user_data:
            return None

        return User(
            id=user_data["id"],
            username=user_data["username"],
            email=user_data.get("email"),
            role=UserRole(user_data["role"]),
            is_active=user_data["is_active"],
            created_at=datetime.fromisoformat(user_data["created_at"]),
            last_login=datetime.fromisoformat(user_data["last_login"])
            if user_data.get("last_login")
            else None,
            password_change_required=user_data.get("password_change_required", False),
        )

    def get_user_by_username(self, username: str) -> Optional[User]:
        """사용자명으로 조회"""
        for user_data in self.users.values():
            if user_data.get("username") == username:
                return self.get_user(user_data["id"])
        return None

    def list_users(self, active_only: bool = False) -> list[User]:
        """사용자 목록 조회"""
        users = []
        for user_data in self.users.values():
            if active_only and not user_data.get("is_active", False):
                continue

            users.append(
                User(
                    id=user_data["id"],
                    username=user_data["username"],
                    email=user_data.get("email"),
                    role=UserRole(user_data["role"]),
                    is_active=user_data["is_active"],
                    created_at=datetime.fromisoformat(user_data["created_at"]),
                    last_login=datetime.fromisoformat(user_data["last_login"])
                    if user_data.get("last_login")
                    else None,
                    password_change_required=user_data.get(
                        "password_change_required", False
                    ),
                )
            )

        return users

    def create_user(self, data: UserCreate) -> User:
        """사용자 생성"""
        # 중복 확인
        if self.get_user_by_username(data.username):
            raise ValueError(f"Username already exists: {data.username}")

        user_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        self.users[user_id] = {
            "id": user_id,
            "username": data.username,
            "email": data.email,
            "password_hash": self._hash_password(data.password),
            "role": data.role.value,
            "is_active": data.is_active,
            "created_at": now.isoformat(),
            "last_login": None,
            "password_change_required": False,  # 관리자가 생성한 계정은 변경 불필요
        }

        self._save_users()

        return User(
            id=user_id,
            username=data.username,
            email=data.email,
            role=data.role,
            is_active=data.is_active,
            created_at=now,
            last_login=None,
            password_change_required=False,
        )

    def update_user(
        self,
        user_id: str,
        email: Optional[str] = None,
        role: Optional[UserRole] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[User]:
        """사용자 정보 수정"""
        user_data = self.users.get(user_id)
        if not user_data:
            return None

        if email is not None:
            user_data["email"] = email
        if role is not None:
            user_data["role"] = role.value
        if is_active is not None:
            user_data["is_active"] = is_active

        self._save_users()
        return self.get_user(user_id)

    def change_password(
        self, user_id: str, old_password: str, new_password: str
    ) -> bool:
        """비밀번호 변경"""
        user_data = self.users.get(user_id)
        if not user_data:
            return False

        if not self._verify_password(old_password, user_data.get("password_hash", "")):
            return False

        user_data["password_hash"] = self._hash_password(new_password)
        user_data["password_change_required"] = False  # 비밀번호 변경 후 플래그 해제
        self._save_users()
        return True

    def reset_password(self, user_id: str, new_password: str) -> bool:
        """비밀번호 초기화 (관리자용)"""
        user_data = self.users.get(user_id)
        if not user_data:
            return False

        user_data["password_hash"] = self._hash_password(new_password)
        user_data["password_change_required"] = True  # 초기화 후 변경 필요
        self._save_users()
        return True

    def delete_user(self, user_id: str) -> bool:
        """사용자 삭제"""
        if user_id in self.users:
            del self.users[user_id]
            self._save_users()
            return True
        return False

    def check_permission(self, user_role: UserRole, required_role: UserRole) -> bool:
        """권한 확인"""
        role_priority = {
            UserRole.VIEWER: 0,
            UserRole.OPERATOR: 1,
            UserRole.ADMIN: 2,
        }

        user_level = role_priority.get(user_role, 0)
        required_level = role_priority.get(required_role, 0)

        return user_level >= required_level

    def get_setup_status(self) -> SetupStatus:
        """초기 설정 상태 확인"""
        has_users = len(self.users) > 0

        # 기본 관리자 계정만 존재하고, 비밀번호 변경이 필요한 경우
        is_default_admin = False
        setup_required = False

        if has_users:
            # admin 계정이 있고 password_change_required가 True인지 확인
            for user_data in self.users.values():
                if user_data.get("username") == "admin" and user_data.get(
                    "password_change_required", False
                ):
                    is_default_admin = True
                    setup_required = True
                    break
        else:
            # 사용자가 없으면 설정이 필요
            setup_required = True

        return SetupStatus(
            setup_required=setup_required,
            has_users=has_users,
            is_default_admin=is_default_admin,
        )
