"""
NewsInsight MCP Shared - Port Configuration

모든 MCP 서버의 포트 할당을 중앙 관리합니다.
포트 충돌을 방지하고 일관된 포트 번호를 유지합니다.

Port Range: 5000-5020
"""

# MCP 서버 포트 할당
MCP_PORTS = {
    "newsinsight_mcp": 5000,  # 감정 분석 및 여론 온도
    "bias_mcp": 5001,  # 편향성 분석
    "factcheck_mcp": 5002,  # 팩트체크
    "topic_mcp": 5003,  # 토픽 추출
    "sentiment_mcp": 5004,  # 감정 분석 (외부 addon)
    "aiagent_mcp": 5010,  # AI Agent LLM 라우팅
    "huggingface_mcp": 5011,  # HuggingFace 모델
    "kaggle_mcp": 5012,  # Kaggle 데이터셋
    "mltraining_mcp": 5013,  # ML 학습
    "roboflow_mcp": 5014,  # Computer Vision
}

# 예약된 포트 (다른 서비스용)
RESERVED_PORTS = {
    5005: "reserved",
    5006: "reserved",
    5007: "reserved",
    5008: "reserved",
    5009: "reserved",
    5015: "reserved",
}


def get_port(server_name: str, default: int = 5000) -> int:
    """
    서버 이름으로 할당된 포트를 반환합니다.

    환경변수 PORT가 설정되어 있으면 환경변수 값을 우선합니다.

    Args:
        server_name: 서버 이름 (예: "newsinsight_mcp")
        default: 기본 포트 번호

    Returns:
        int: 포트 번호
    """
    import os

    # 환경변수 우선
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass

    return MCP_PORTS.get(server_name, default)


def validate_ports() -> dict:
    """
    포트 할당의 유효성을 검증합니다.

    Returns:
        dict: 검증 결과 (conflicts, warnings)
    """
    result = {
        "valid": True,
        "conflicts": [],
        "warnings": [],
    }

    # 포트 중복 확인
    port_to_servers = {}
    for server, port in MCP_PORTS.items():
        if port in port_to_servers:
            result["valid"] = False
            result["conflicts"].append(
                {
                    "port": port,
                    "servers": [port_to_servers[port], server],
                }
            )
        else:
            port_to_servers[port] = server

    # 예약된 포트 사용 확인
    for server, port in MCP_PORTS.items():
        if port in RESERVED_PORTS:
            result["warnings"].append(
                {
                    "port": port,
                    "server": server,
                    "reason": f"Using reserved port: {RESERVED_PORTS[port]}",
                }
            )

    return result


if __name__ == "__main__":
    # 포트 할당 출력
    print("MCP Server Port Assignments:")
    print("-" * 40)
    for server, port in sorted(MCP_PORTS.items(), key=lambda x: x[1]):
        print(f"  {server}: {port}")

    print("\nValidation:")
    validation = validate_ports()
    if validation["valid"]:
        print("  ✓ All ports are valid")
    else:
        for conflict in validation["conflicts"]:
            print(f"  ✗ Port conflict: {conflict}")
