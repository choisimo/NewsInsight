"""
Authentication Middleware for autonomous-crawler-service.

Provides FastAPI dependencies for JWT-based authentication.
"""

import os
from functools import wraps
from typing import Callable, Optional

import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .jwt_utils import JWTPayload, verify_jwt_token

logger = structlog.get_logger(__name__)

# Security enabled flag - set to False only in development
SECURITY_ENABLED = os.getenv("SECURITY_ENABLED", "true").lower() == "true"

# HTTP Bearer scheme for extracting tokens
bearer_scheme = HTTPBearer(auto_error=False)


class AuthMiddleware:
    """
    Authentication middleware for FastAPI.
    
    Usage:
        app.add_middleware(AuthMiddleware)
    
    Or use the dependency injection approach with get_current_user.
    """
    
    # Endpoints that don't require authentication
    PUBLIC_PATHS = {
        "/health",
        "/",
        "/docs",
        "/openapi.json",
        "/redoc",
    }
    
    # Path prefixes that don't require authentication
    PUBLIC_PREFIXES = (
        "/health",
        "/docs",
        "/openapi",
        "/redoc",
    )

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
            
        path = scope.get("path", "")
        
        # Skip auth for public paths
        if path in self.PUBLIC_PATHS or path.startswith(self.PUBLIC_PREFIXES):
            await self.app(scope, receive, send)
            return
            
        # Skip auth if disabled
        if not SECURITY_ENABLED:
            await self.app(scope, receive, send)
            return
            
        await self.app(scope, receive, send)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[JWTPayload]:
    """
    FastAPI dependency to get the current authenticated user.
    
    Returns None if:
    - Security is disabled
    - No token is provided
    - Token is invalid
    
    Usage:
        @app.get("/protected")
        async def protected_endpoint(user: JWTPayload = Depends(get_current_user)):
            if user is None:
                raise HTTPException(status_code=401)
            return {"user": user.username}
    """
    if not SECURITY_ENABLED:
        # Return a dummy user when security is disabled
        return JWTPayload(
            user_id="dev-user",
            username="developer",
            role="admin",
            exp=0,
            iat=0,
        )
    
    if credentials is None:
        return None
        
    token = credentials.credentials
    return verify_jwt_token(token)


def require_auth(
    roles: Optional[list[str]] = None,
) -> Callable:
    """
    FastAPI dependency factory that requires authentication.
    
    Args:
        roles: Optional list of required roles (e.g., ["admin", "operator"])
        
    Usage:
        @app.get("/admin-only")
        async def admin_endpoint(user: JWTPayload = Depends(require_auth(roles=["admin"]))):
            return {"message": "Admin access granted"}
            
        @app.get("/authenticated")
        async def auth_endpoint(user: JWTPayload = Depends(require_auth())):
            return {"message": f"Hello {user.username}"}
    """
    async def dependency(
        user: Optional[JWTPayload] = Depends(get_current_user),
    ) -> JWTPayload:
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if roles:
            user_role = user.role.lower()
            allowed_roles = [r.lower() for r in roles]
            
            # Admin has access to everything
            if user_role == "admin":
                return user
                
            if user_role not in allowed_roles:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Requires one of the following roles: {', '.join(roles)}",
                )
        
        return user
    
    return dependency


def require_admin() -> Callable:
    """Shorthand for require_auth(roles=["admin"])"""
    return require_auth(roles=["admin"])


def require_operator() -> Callable:
    """Shorthand for require_auth(roles=["admin", "operator"])"""
    return require_auth(roles=["admin", "operator"])
