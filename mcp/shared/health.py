"""
NewsInsight MCP Shared - Health Check Module

Health check 엔드포인트와 핸들러를 제공하는 공유 모듈입니다.
"""

import json
from datetime import datetime
from typing import Callable
from http.server import BaseHTTPRequestHandler

from starlette.responses import JSONResponse
from starlette.requests import Request


def create_health_endpoint(server_name: str, version: str = "1.0.0"):
    """
    Health check 엔드포인트 핸들러를 생성합니다.

    Args:
        server_name: 서버 이름 (예: "news-insight-mcp")
        version: 서버 버전

    Returns:
        async function: Starlette 라우트 핸들러

    Usage:
        @server.custom_route("/health", methods=["GET"])
        async def health_endpoint(request: Request) -> JSONResponse:
            return await create_health_endpoint("my-server", "1.0.0")(request)
    """

    async def health_handler(request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "status": "healthy",
                "server": server_name,
                "version": version,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    return health_handler


class HealthCheckHandler(BaseHTTPRequestHandler):
    """
    간단한 HTTP 헬스체크 엔드포인트 핸들러.

    별도의 HTTP 서버로 헬스체크를 제공할 때 사용합니다.

    Usage:
        handler = HealthCheckHandler.create_handler("my-server", "1.0.0")
        httpd = HTTPServer(("0.0.0.0", 8080), handler)
        httpd.serve_forever()
    """

    server_name = "mcp-server"
    server_version = "1.0.0"

    @classmethod
    def create_handler(cls, server_name: str, version: str = "1.0.0"):
        """
        커스텀 서버 정보로 핸들러 클래스를 생성합니다.
        """

        class CustomHandler(cls):
            pass

        CustomHandler.server_name = server_name
        CustomHandler.server_version = version
        return CustomHandler

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "status": "healthy",
                "server": self.server_name,
                "version": self.server_version,
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # 로깅 비활성화
        pass


def create_health_response(
    server_name: str,
    version: str = "1.0.0",
    extra_info: dict = None,
) -> dict:
    """
    Health check 응답 딕셔너리를 생성합니다.

    Args:
        server_name: 서버 이름 (예: "news-insight-mcp")
        version: 서버 버전
        extra_info: 추가 상태 정보 (예: DB 연결 상태)

    Returns:
        dict: Health check 응답 딕셔너리

    Usage:
        return JSONResponse(create_health_response("my-server", "1.0.0", db_status))
    """
    response = {
        "status": "healthy",
        "server": server_name,
        "version": version,
        "timestamp": datetime.utcnow().isoformat(),
    }

    if extra_info:
        response.update(extra_info)
        # Check for error conditions
        if extra_info.get("db_error"):
            response["status"] = "degraded"

    return response


def get_health_status(
    server_name: str,
    version: str,
    db_status: dict = None,
    extra_status: dict = None,
) -> dict:
    """
    종합 헬스 상태를 반환합니다.

    Args:
        server_name: 서버 이름
        version: 서버 버전
        db_status: DB 연결 상태 (선택)
        extra_status: 추가 상태 정보 (선택)

    Returns:
        dict: 종합 헬스 상태
    """
    status = {
        "server": server_name,
        "version": version,
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
    }

    if db_status:
        status.update(db_status)
        if db_status.get("db_error"):
            status["status"] = "degraded"

    if extra_status:
        status.update(extra_status)

    return status
