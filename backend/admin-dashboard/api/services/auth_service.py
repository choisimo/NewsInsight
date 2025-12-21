"""
Auth Service - 인증/권한 관리 서비스

Refresh Token 보안:
- Refresh token은 HTTP-Only, Secure 쿠키로 전송
- Redis에 refresh token 해시를 저장하여 검증
- Token Rotation: 갱신 시 기존 토큰 폐기, 새 토큰 발급
"""

import asyncio
import hashlib
import os
import random
import secrets
import string
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yaml
from jose import JWTError, jwt

from ..models.schemas import Token, TokenData, User, UserCreate, UserRole, SetupStatus


class RedisClient:
    """간단한 비동기 Redis 클라이언트"""

    def __init__(self, host: str = "redis", port: int = 6379):
        self.host = host
        self.port = port
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None

    async def connect(self) -> bool:
        """Redis 연결"""
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=5.0
            )
            return True
        except Exception:
            return False

    async def close(self):
        """연결 종료"""
        if self._writer:
            self._writer.close()
            await self._writer.wait_closed()
            self._writer = None
            self._reader = None

    async def _send_command(self, *args) -> Optional[str]:
        """Redis 명령 전송"""
        try:
            if not self._writer:
                if not await self.connect():
                    return None

            # RESP 프로토콜로 명령 인코딩
            cmd = f"*{len(args)}\r\n"
            for arg in args:
                arg_str = str(arg)
                cmd += f"${len(arg_str)}\r\n{arg_str}\r\n"

            self._writer.write(cmd.encode())
            await self._writer.drain()

            # 응답 읽기
            response = await asyncio.wait_for(self._reader.readline(), timeout=5.0)
            response_str = response.decode("utf-8", errors="ignore").strip()

            # Simple string (+OK)
            if response_str.startswith("+"):
                return response_str[1:]
            # Error (-ERR)
            elif response_str.startswith("-"):
                return None
            # Integer (:1)
            elif response_str.startswith(":"):
                return response_str[1:]
            # Bulk string ($5\r\nhello)
            elif response_str.startswith("$"):
                length = int(response_str[1:])
                if length == -1:
                    return None
                data = await self._reader.read(length + 2)  # +2 for \r\n
                return data[:-2].decode("utf-8", errors="ignore")
            # Null
            elif response_str == "$-1":
                return None

            return response_str
        except Exception:
            await self.close()
            return None

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        """키-값 설정 (선택적 TTL)"""
        if ex:
            result = await self._send_command("SET", key, value, "EX", str(ex))
        else:
            result = await self._send_command("SET", key, value)
        return result == "OK"

    async def get(self, key: str) -> Optional[str]:
        """키로 값 조회"""
        return await self._send_command("GET", key)

    async def delete(self, key: str) -> bool:
        """키 삭제"""
        result = await self._send_command("DEL", key)
        return result == "1"

    async def exists(self, key: str) -> bool:
        """키 존재 여부"""
        result = await self._send_command("EXISTS", key)
        return result == "1"

    async def keys(self, pattern: str) -> list[str]:
        """패턴으로 키 검색"""
        try:
            if not self._writer:
                if not await self.connect():
                    return []

            cmd = f"*2\r\n$4\r\nKEYS\r\n${len(pattern)}\r\n{pattern}\r\n"
            self._writer.write(cmd.encode())
            await self._writer.drain()

            # Array 응답 읽기
            response = await asyncio.wait_for(self._reader.readline(), timeout=5.0)
            response_str = response.decode("utf-8", errors="ignore").strip()

            if not response_str.startswith("*"):
                return []

            count = int(response_str[1:])
            if count <= 0:
                return []

            keys = []
            for _ in range(count):
                # Bulk string length
                length_line = await self._reader.readline()
                length = int(length_line.decode().strip()[1:])
                # Bulk string value
                data = await self._reader.read(length + 2)
                keys.append(data[:-2].decode("utf-8", errors="ignore"))

            return keys
        except Exception:
            return []


class AuthService:
    """인증/권한 서비스"""

    # Redis 키 접두사
    REFRESH_TOKEN_PREFIX = "refresh_token:"
    USER_TOKENS_PREFIX = "user_tokens:"

    def __init__(
        self,
        config_dir: str,
        secret_key: Optional[str] = None,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = 60,
        refresh_token_expire_days: int = 7,
    ):
        self.config_dir = Path(config_dir)
        self.secret_key = secret_key or secrets.token_urlsafe(32)
        self.algorithm = algorithm
        self.access_token_expire_minutes = access_token_expire_minutes
        self.refresh_token_expire_days = refresh_token_expire_days
        self.users: dict[str, dict] = {}
        self.email_verifications: dict[str, dict] = {}

        # Redis 설정
        self.redis_host = os.environ.get("REDIS_HOST", "redis")
        self.redis_port = int(os.environ.get("REDIS_PORT", "6379"))
        self._redis: Optional[RedisClient] = None

        # 폴백용 메모리 저장소 (Redis 연결 실패 시)
        self._memory_tokens: dict[str, dict] = {}

        self._load_users()

    async def _get_redis(self) -> Optional[RedisClient]:
        """Redis 클라이언트 가져오기"""
        if self._redis is None:
            self._redis = RedisClient(self.redis_host, self.redis_port)
            if not await self._redis.connect():
                self._redis = None
        return self._redis

    def _hash_token(self, token: str) -> str:
        """토큰 해시 (SHA256)"""
        return hashlib.sha256(token.encode()).hexdigest()

    async def _store_refresh_token(
        self, jti: str, user_id: str, token_hash: str, expires_in_seconds: int
    ) -> bool:
        """Redis에 refresh token 저장"""
        redis = await self._get_redis()

        data = f"{user_id}:{token_hash}:{datetime.utcnow().isoformat()}"

        if redis:
            # Redis에 저장
            success = await redis.set(
                f"{self.REFRESH_TOKEN_PREFIX}{jti}", data, ex=expires_in_seconds
            )
            if success:
                return True

        # Redis 실패 시 메모리 폴백
        self._memory_tokens[jti] = {
            "user_id": user_id,
            "token_hash": token_hash,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (
                datetime.utcnow() + timedelta(seconds=expires_in_seconds)
            ).isoformat(),
        }
        return True

    async def _verify_refresh_token(self, jti: str, token_hash: str) -> Optional[str]:
        """Redis에서 refresh token 검증, 유효하면 user_id 반환"""
        redis = await self._get_redis()

        if redis:
            data = await redis.get(f"{self.REFRESH_TOKEN_PREFIX}{jti}")
            if data:
                parts = data.split(":", 2)
                if len(parts) >= 2:
                    stored_user_id, stored_hash = parts[0], parts[1]
                    # 해시 비교
                    if secrets.compare_digest(stored_hash, token_hash):
                        return stored_user_id
            return None

        # Redis 실패 시 메모리 폴백
        token_data = self._memory_tokens.get(jti)
        if token_data:
            # 만료 확인
            expires_at = datetime.fromisoformat(token_data["expires_at"])
            if datetime.utcnow() > expires_at:
                del self._memory_tokens[jti]
                return None

            # 해시 비교
            if secrets.compare_digest(token_data["token_hash"], token_hash):
                return token_data["user_id"]

        return None

    async def _revoke_refresh_token(self, jti: str) -> bool:
        """refresh token 폐기"""
        redis = await self._get_redis()

        if redis:
            return await redis.delete(f"{self.REFRESH_TOKEN_PREFIX}{jti}")

        # 메모리 폴백
        if jti in self._memory_tokens:
            del self._memory_tokens[jti]
            return True
        return False

    async def _revoke_all_user_tokens_async(self, user_id: str) -> int:
        """사용자의 모든 refresh token 폐기 (비동기)"""
        revoked = 0
        redis = await self._get_redis()

        if redis:
            keys = await redis.keys(f"{self.REFRESH_TOKEN_PREFIX}*")
            for key in keys:
                data = await redis.get(key)
                if data and data.startswith(f"{user_id}:"):
                    await redis.delete(key)
                    revoked += 1
        else:
            # 메모리 폴백
            to_delete = [
                jti
                for jti, data in self._memory_tokens.items()
                if data.get("user_id") == user_id
            ]
            for jti in to_delete:
                del self._memory_tokens[jti]
                revoked += 1

        return revoked

    def _load_users(self) -> None:
        """사용자 정보 로드"""
        users_file = self.config_dir / "users.yaml"
        if users_file.exists():
            with open(users_file) as f:
                data = yaml.safe_load(f) or {}
                self.users = data.get("users", {})
        else:
            self._create_default_admin()

    def _create_default_admin(self) -> None:
        """기본 관리자 계정 생성"""
        admin_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

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
            "password_change_required": True,
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

    async def create_tokens(self, user: User) -> tuple[str, str, str]:
        """액세스 토큰과 리프레시 토큰 생성

        Returns:
            tuple: (access_token, refresh_token, jti)
        """
        access_expire = datetime.utcnow() + timedelta(
            minutes=self.access_token_expire_minutes
        )
        refresh_expire = datetime.utcnow() + timedelta(
            days=self.refresh_token_expire_days
        )

        jti = secrets.token_urlsafe(32)

        # Access token (짧은 수명, 클라이언트 저장)
        access_payload = {
            "sub": user.id,
            "username": user.username,
            "role": user.role.value,
            "exp": access_expire,
            "type": "access",
        }

        # Refresh token (긴 수명, HTTP-Only 쿠키)
        refresh_payload = {
            "sub": user.id,
            "exp": refresh_expire,
            "type": "refresh",
            "jti": jti,
        }

        access_token = jwt.encode(
            access_payload, self.secret_key, algorithm=self.algorithm
        )
        refresh_token = jwt.encode(
            refresh_payload, self.secret_key, algorithm=self.algorithm
        )

        # Refresh token 해시를 Redis에 저장
        token_hash = self._hash_token(refresh_token)
        expires_in = self.refresh_token_expire_days * 24 * 60 * 60

        await self._store_refresh_token(jti, user.id, token_hash, expires_in)

        return access_token, refresh_token, jti

    def create_access_token(self, user: User) -> Token:
        """동기 버전: 액세스 토큰만 생성 (기존 호환성)

        Note: refresh token은 create_tokens_async 사용 권장
        """
        access_expire = datetime.utcnow() + timedelta(
            minutes=self.access_token_expire_minutes
        )

        access_payload = {
            "sub": user.id,
            "username": user.username,
            "role": user.role.value,
            "exp": access_expire,
            "type": "access",
        }

        access_token = jwt.encode(
            access_payload, self.secret_key, algorithm=self.algorithm
        )

        # 동기 버전에서는 refresh token을 빈 문자열로 반환
        # 실제 사용 시 create_tokens_async 사용 권장
        return Token(
            access_token=access_token,
            refresh_token="",
            token_type="bearer",
            expires_in=self.access_token_expire_minutes * 60,
            refresh_expires_in=0,
        )

    async def refresh_access_token(self, refresh_token: str) -> Optional[Token]:
        """리프레시 토큰으로 새 토큰 발급

        - 기존 refresh token 검증 (해시 비교)
        - 기존 토큰 폐기 (Token Rotation)
        - 새 토큰 쌍 발급
        """
        try:
            payload = jwt.decode(
                refresh_token, self.secret_key, algorithms=[self.algorithm]
            )

            if payload.get("type") != "refresh":
                return None

            user_id = payload.get("sub")
            jti = payload.get("jti")

            if not user_id or not jti:
                return None

            # Redis에서 토큰 해시 검증
            token_hash = self._hash_token(refresh_token)
            verified_user_id = await self._verify_refresh_token(jti, token_hash)

            if not verified_user_id or verified_user_id != user_id:
                return None

            # 사용자 확인
            user = self.get_user(user_id)
            if not user or not user.is_active:
                return None

            # 기존 토큰 폐기 (Token Rotation)
            await self._revoke_refresh_token(jti)

            # 새 토큰 쌍 발급
            new_access, new_refresh, _ = await self.create_tokens(user)

            return Token(
                access_token=new_access,
                refresh_token=new_refresh,
                token_type="bearer",
                expires_in=self.access_token_expire_minutes * 60,
                refresh_expires_in=self.refresh_token_expire_days * 24 * 60 * 60,
            )

        except JWTError:
            return None

    async def revoke_refresh_token(self, refresh_token: str) -> bool:
        """리프레시 토큰 폐기"""
        try:
            payload = jwt.decode(
                refresh_token, self.secret_key, algorithms=[self.algorithm]
            )
            jti = payload.get("jti")

            if jti:
                return await self._revoke_refresh_token(jti)
            return False
        except JWTError:
            return False

    def revoke_all_user_tokens(self, user_id: str) -> int:
        """사용자의 모든 리프레시 토큰 폐기 (동기 래퍼)"""
        try:
            loop = asyncio.get_event_loop()
            return loop.run_until_complete(self._revoke_all_user_tokens_async(user_id))
        except RuntimeError:
            # 이벤트 루프가 없거나 실행 중인 경우
            # 메모리 폴백만 처리
            to_delete = [
                jti
                for jti, data in self._memory_tokens.items()
                if data.get("user_id") == user_id
            ]
            for jti in to_delete:
                del self._memory_tokens[jti]
            return len(to_delete)

    async def revoke_all_user_tokens_async(self, user_id: str) -> int:
        """사용자의 모든 리프레시 토큰 폐기 (비동기)"""
        return await self._revoke_all_user_tokens_async(user_id)

    def verify_token(self, token: str) -> Optional[TokenData]:
        """토큰 검증"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])

            user_id = payload.get("sub")
            username = payload.get("username")
            role = payload.get("role")
            exp = payload.get("exp")

            if not user_id or not username or not role or not exp:
                return None

            return TokenData(
                user_id=str(user_id),
                username=str(username),
                role=UserRole(role),
                exp=datetime.fromtimestamp(float(exp)),
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
            "password_change_required": False,
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
        """일반 사용자 회원가입"""
        if self.get_user_by_username(username):
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")

        if self.get_user_by_email(email):
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")

        user_id = f"user-{uuid4().hex[:8]}"
        now = datetime.utcnow()

        self.users[user_id] = {
            "id": user_id,
            "username": username,
            "email": email,
            "password_hash": self._hash_password(password),
            "role": UserRole.USER.value,
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
        user_data["password_change_required"] = False
        self._save_users()
        return True

    def reset_password(self, user_id: str, new_password: str) -> bool:
        """비밀번호 초기화 (관리자용)"""
        user_data = self.users.get(user_id)
        if not user_data:
            return False

        user_data["password_hash"] = self._hash_password(new_password)
        user_data["password_change_required"] = True
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

        is_default_admin = False
        setup_required = False

        if has_users:
            for user_data in self.users.values():
                if user_data.get("username") == "admin" and user_data.get(
                    "password_change_required", False
                ):
                    is_default_admin = True
                    setup_required = True
                    break
        else:
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
        return "".join(random.choices(string.digits, k=6))

    def create_email_verification(
        self, email: str, username: str, password: str
    ) -> str:
        """이메일 인증 요청 생성"""
        if self.get_user_by_email(email):
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")

        if self.get_user_by_username(username):
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")

        code = self.generate_verification_code()
        expires_at = datetime.utcnow() + timedelta(minutes=10)

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
        """이메일 인증 코드 검증 및 회원가입 완료"""
        verification = self.email_verifications.get(email)

        if not verification:
            raise ValueError("인증 요청을 찾을 수 없습니다. 다시 시도해주세요.")

        verification["attempts"] += 1

        if verification["attempts"] > 5:
            del self.email_verifications[email]
            raise ValueError(
                "인증 시도 횟수를 초과했습니다. 처음부터 다시 시도해주세요."
            )

        expires_at = datetime.fromisoformat(verification["expires_at"])
        if datetime.utcnow() > expires_at:
            del self.email_verifications[email]
            raise ValueError("인증 코드가 만료되었습니다. 다시 시도해주세요.")

        if verification["code"] != code:
            raise ValueError(
                f"잘못된 인증 코드입니다. (남은 시도: {5 - verification['attempts']}회)"
            )

        username = verification["username"]
        password_hash = verification["password_hash"]

        if self.get_user_by_email(email):
            del self.email_verifications[email]
            raise ValueError(f"이미 사용 중인 이메일입니다: {email}")

        if self.get_user_by_username(username):
            del self.email_verifications[email]
            raise ValueError(f"이미 사용 중인 사용자명입니다: {username}")

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
        """인증 코드 재발송"""
        verification = self.email_verifications.get(email)

        if not verification:
            raise ValueError(
                "인증 요청을 찾을 수 없습니다. 처음부터 다시 시도해주세요."
            )

        code = self.generate_verification_code()
        verification["code"] = code
        verification["expires_at"] = (
            datetime.utcnow() + timedelta(minutes=10)
        ).isoformat()
        verification["attempts"] = 0

        return code
