"""
JWT Utilities for autonomous-crawler-service.
"""

import os
from dataclasses import dataclass
from typing import Optional

import jwt
import structlog

logger = structlog.get_logger(__name__)

# Secret key for JWT verification (shared with admin-dashboard)
JWT_SECRET = os.getenv("ADMIN_SECRET_KEY", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"


@dataclass
class JWTPayload:
    """JWT Token Payload"""
    user_id: str
    username: str
    role: str
    exp: int
    iat: int


def verify_jwt_token(token: str) -> Optional[JWTPayload]:
    """
    Verify JWT token and return payload.
    
    Args:
        token: JWT token string (without 'Bearer ' prefix)
        
    Returns:
        JWTPayload if valid, None otherwise
    """
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
        
        return JWTPayload(
            user_id=payload.get("sub", ""),
            username=payload.get("username", ""),
            role=payload.get("role", "user"),
            exp=payload.get("exp", 0),
            iat=payload.get("iat", 0),
        )
        
    except jwt.ExpiredSignatureError:
        logger.warning("JWT token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning("Invalid JWT token", error=str(e))
        return None
    except Exception as e:
        logger.error("JWT verification error", error=str(e))
        return None
