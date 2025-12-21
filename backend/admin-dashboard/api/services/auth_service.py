"""
Auth Service - 인증/권한 관리 서비스
"""

import hashlib
import secrets
import random
import string
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
        self.email_verifications: dict[str, dict] = {}  # email -> verification data
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

    def get_user_by_email(self, email: str) -> Optional[User]:
        """이메일로 조회"""
        for user_data in self.users.values():
            if user_data.get("email") == email:
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

    def register_user(self, username: str, email: str, password: str) -> User:
        """일반 사용자 회원가입

        - 사용자명 중복 체크
        - 이메일 중복 체크
        - role은 항상 USER로 고정
        """
        # 사용자명 중복 확인
        if self.get_user_by_username(username):
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")

        # 이메일 중복 확인
        if self.get_user_by_email(email):
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")

        user_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        self.users[user_id] = {
            "id": user_id,
            "username": username,
            "email": email,
            "password_hash": self._hash_password(password),
            "role": UserRole.USER.value,  # 항상 일반 사용자
            "is_active": True,
            "created_at": now.isoformat(),
            "last_login": None,
            "password_change_required": False,
        }

        self._save_users()

        return User(
            id=user_id,
            username=username,
            email=email,
            role=UserRole.USER,
            is_active=True,
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

    # ============================================================================
    # Email Verification Methods
    # ============================================================================

    def generate_verification_code(self) -> str:
        """6자리 인증 코드 생성"""
        return ''.join(random.choices(string.digits, k=6))

    def create_email_verification(self, email: str, username: str, password: str) -> str:
        """이메일 인증 요청 생성 (회원가입 전 단계)
        
        Returns:
            verification_code: 6자리 인증 코드
        """
        # 이미 존재하는 이메일인지 확인
        if self.get_user_by_email(email):
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")
        
        # 이미 존재하는 사용자명인지 확인
        if self.get_user_by_username(username):
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")

        code = self.generate_verification_code()
        expires_at = datetime.utcnow() + timedelta(minutes=10)  # 10분 유효

        self.email_verifications[email] = {
            "code": code,
            "username": username,
            "password_hash": self._hash_password(password),
            "expires_at": expires_at.isoformat(),
            "created_at": datetime.utcnow().isoformat(),
            "attempts": 0,
        }

        return code

    def verify_email_code(self, email: str, code: str) -> User:
        """이메일 인증 코드 검증 및 회원가입 완료
        
        Args:
            email: 이메일 주소
            code: 6자리 인증 코드
            
        Returns:
            User: 생성된 사용자 객체
            
        Raises:
            ValueError: 유효하지 않은 인증 코드 또는 만료된 경우
        """
        verification = self.email_verifications.get(email)
        
        if not verification:
            raise ValueError("인증 요청을 찾을 수 없습니다. 다시 시도해주세요.")
        
        # 시도 횟수 증가
        verification["attempts"] += 1
        
        # 최대 시도 횟수 초과
        if verification["attempts"] > 5:
            del self.email_verifications[email]
            raise ValueError("인증 시도 횟수를 초과했습니다. 처음부터 다시 시도해주세요.")
        
        # 만료 확인
        expires_at = datetime.fromisoformat(verification["expires_at"])
        if datetime.utcnow() > expires_at:
            del self.email_verifications[email]
            raise ValueError("인증 코드가 만료되었습니다. 다시 시도해주세요.")
        
        # 코드 확인
        if verification["code"] != code:
            raise ValueError(f"잘못된 인증 코드입니다. (남은 시도: {5 - verification['attempts']}회)")
        
        # 인증 성공 - 회원가입 완료
        username = verification["username"]
        password_hash = verification["password_hash"]
        
        # 최종 중복 확인
        if self.get_user_by_email(email):
            del self.email_verifications[email]
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")
        
        if self.get_user_by_username(username):
            del self.email_verifications[email]
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")
        
        # 사용자 생성
        user_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        self.users[user_id] = {
            "id": user_id,
            "username": username,
            "email": email,
            "password_hash": password_hash,
            "role": UserRole.USER.value,
            "is_active": True,
            "created_at": now.isoformat(),
            "last_login": None,
            "password_change_required": False,
            "email_verified": True,
        }

        self._save_users()
        
        # 인증 정보 삭제
        del self.email_verifications[email]

        return User(
            id=user_id,
            username=username,
            email=email,
            role=UserRole.USER,
            is_active=True,
            created_at=now,
            last_login=None,
            password_change_required=False,
        )

    def resend_verification_code(self, email: str) -> str:
        """인증 코드 재발송
        
        Returns:
            새로운 인증 코드
        """
        verification = self.email_verifications.get(email)
        
        if not verification:
            raise ValueError("인증 요청을 찾을 수 없습니다. 처음부터 다시 시도해주세요.")
        
        # 새 코드 생성
        code = self.generate_verification_code()
        verification["code"] = code
        verification["expires_at"] = (datetime.utcnow() + timedelta(minutes=10)).isoformat()
        verification["attempts"] = 0
        
        return code
