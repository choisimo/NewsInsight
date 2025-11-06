from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from app.config import settings

router = APIRouter()

async def proxy_request(request: Request, path: str = ""):
    """
    Alert 서비스로 요청을 프록시합니다.

    Args:
        request: 클라이언트에서 들어온 FastAPI Request 객체
        path: Alert 서비스에 전달할 하위 경로

    Returns:
        FastAPI JSONResponse: Alert 서비스 응답을 그대로 전달

    Raises:
        HTTPException: 타임아웃, 연결 실패, 미지원 메서드 등 오류 상황
    """
    # Remove the /api/v1/alerts prefix from the path
    target_path = path if path else ""
    
    # Build the target URL
    target_url = f"{settings.ALERT_SERVICE_URL}/{target_path}"
    
    # Get the request method and prepare headers
    method = request.method
    headers = dict(request.headers)
    
    # Remove host header to avoid conflicts
    headers.pop("host", None)
    
    try:
        async with httpx.AsyncClient(timeout=settings.DEFAULT_TIMEOUT) as client:
            # Handle different HTTP methods
            if method == "GET":
                response = await client.get(
                    target_url,
                    headers=headers,
                    params=request.query_params
                )
            elif method == "POST":
                body = await request.body()
                response = await client.post(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            elif method == "PUT":
                body = await request.body()
                response = await client.put(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            elif method == "DELETE":
                response = await client.delete(
                    target_url,
                    headers=headers,
                    params=request.query_params
                )
            elif method == "PATCH":
                body = await request.body()
                response = await client.patch(
                    target_url,
                    headers=headers,
                    params=request.query_params,
                    content=body
                )
            else:
                raise HTTPException(status_code=405, detail="Method not allowed")
            
            # Return the response from the target service
            return JSONResponse(
                content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
            
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Alert service timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Alert service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# Alert Service Endpoints

@router.get("/health")
async def health_check(request: Request):
    """Alert 서비스 헬스 체크 결과를 반환합니다."""
    return await proxy_request(request, "health")

@router.get("/")
async def root(request: Request):
    """Alert 서비스 루트 엔드포인트 응답을 프록시합니다."""
    return await proxy_request(request, "")

# Alert Management Routes
@router.post("/alerts")
async def create_alert(request: Request):
    """새로운 알림을 생성합니다."""
    return await proxy_request(request, "alerts")

@router.get("/alerts")
async def list_alerts(request: Request):
    """모든 알림 목록을 조회합니다."""
    return await proxy_request(request, "alerts")

@router.get("/alerts/{alert_id}")
async def get_alert(alert_id: str, request: Request):
    """특정 알림 상세 정보를 조회합니다."""
    return await proxy_request(request, f"alerts/{alert_id}")

@router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, request: Request):
    """특정 알림을 업데이트합니다."""
    return await proxy_request(request, f"alerts/{alert_id}")

@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, request: Request):
    """특정 알림을 삭제합니다."""
    return await proxy_request(request, f"alerts/{alert_id}")

@router.post("/alerts/{alert_id}/trigger")
async def trigger_alert(alert_id: str, request: Request):
    """특정 알림을 수동으로 트리거합니다."""
    return await proxy_request(request, f"alerts/{alert_id}/trigger")

@router.post("/alerts/{alert_id}/enable")
async def enable_alert(alert_id: str, request: Request):
    """특정 알림을 활성화합니다."""
    return await proxy_request(request, f"alerts/{alert_id}/enable")

@router.post("/alerts/{alert_id}/disable")
async def disable_alert(alert_id: str, request: Request):
    """특정 알림을 비활성화합니다."""
    return await proxy_request(request, f"alerts/{alert_id}/disable")

@router.get("/alerts/{alert_id}/history")
async def get_alert_history(alert_id: str, request: Request):
    """특정 알림의 트리거 이력을 조회합니다."""
    return await proxy_request(request, f"alerts/{alert_id}/history")

@router.post("/alerts/bulk")
async def bulk_alert_operations(request: Request):
    """알림에 대한 일괄 작업을 수행합니다."""
    return await proxy_request(request, "alerts/bulk")

@router.get("/alerts/stats")
async def get_alert_stats(request: Request):
    """알림 통계를 조회합니다."""
    return await proxy_request(request, "alerts/stats")

@router.get("/alerts/dashboard")
async def get_alert_dashboard(request: Request):
    """알림 대시보드 데이터를 조회합니다."""
    return await proxy_request(request, "alerts/dashboard")

# Rule Management Routes
@router.post("/rules")
async def create_rule(request: Request):
    """새로운 알림 규칙을 생성합니다."""
    return await proxy_request(request, "rules")

@router.get("/rules")
async def list_rules(request: Request):
    """모든 알림 규칙을 조회합니다."""
    return await proxy_request(request, "rules")

@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str, request: Request):
    """특정 알림 규칙을 조회합니다."""
    return await proxy_request(request, f"rules/{rule_id}")

@router.put("/rules/{rule_id}")
async def update_rule(rule_id: str, request: Request):
    """알림 규칙을 업데이트합니다."""
    return await proxy_request(request, f"rules/{rule_id}")

@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    """알림 규칙을 삭제합니다."""
    return await proxy_request(request, f"rules/{rule_id}")

@router.post("/rules/{rule_id}/test")
async def test_rule(rule_id: str, request: Request):
    """특정 알림 규칙을 테스트합니다."""
    return await proxy_request(request, f"rules/{rule_id}/test")

@router.get("/rules/templates")
async def get_rule_templates(request: Request):
    """알림 규칙 템플릿 목록을 조회합니다."""
    return await proxy_request(request, "rules/templates")

@router.get("/rules/templates/{template_id}")
async def get_rule_template(template_id: str, request: Request):
    """특정 알림 규칙 템플릿을 조회합니다."""
    return await proxy_request(request, f"rules/templates/{template_id}")

# Notification Management Routes
@router.post("/notifications")
async def create_notification(request: Request):
    """새로운 알림 메시지를 생성합니다."""
    return await proxy_request(request, "notifications")

@router.get("/notifications")
async def list_notifications(request: Request):
    """모든 알림 메시지를 조회합니다."""
    return await proxy_request(request, "notifications")

@router.get("/notifications/{notification_id}")
async def get_notification(notification_id: str, request: Request):
    """특정 알림 메시지를 조회합니다."""
    return await proxy_request(request, f"notifications/{notification_id}")

@router.put("/notifications/{notification_id}")
async def update_notification(notification_id: str, request: Request):
    """알림 메시지를 업데이트합니다."""
    return await proxy_request(request, f"notifications/{notification_id}")

@router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, request: Request):
    """알림 메시지를 삭제합니다."""
    return await proxy_request(request, f"notifications/{notification_id}")

@router.post("/notifications/test")
async def test_notification(request: Request):
    """알림 발송 테스트를 수행합니다."""
    return await proxy_request(request, "notifications/test")

@router.get("/notifications/stats")
async def get_notification_stats(request: Request):
    """알림 통계를 조회합니다."""
    return await proxy_request(request, "notifications/stats")

# Subscription Management Routes
@router.post("/subscriptions")
async def create_subscription(request: Request):
    """새로운 알림 구독을 생성합니다."""
    return await proxy_request(request, "subscriptions")

@router.get("/subscriptions")
async def list_subscriptions(request: Request):
    """모든 알림 구독을 조회합니다."""
    return await proxy_request(request, "subscriptions")

@router.get("/subscriptions/{subscription_id}")
async def get_subscription(subscription_id: str, request: Request):
    """특정 알림 구독 정보를 조회합니다."""
    return await proxy_request(request, f"subscriptions/{subscription_id}")

@router.put("/subscriptions/{subscription_id}")
async def update_subscription(subscription_id: str, request: Request):
    """알림 구독을 업데이트합니다."""
    return await proxy_request(request, f"subscriptions/{subscription_id}")

@router.delete("/subscriptions/{subscription_id}")
async def delete_subscription(subscription_id: str, request: Request):
    """알림 구독을 삭제합니다."""
    return await proxy_request(request, f"subscriptions/{subscription_id}")

# Catch-all route for any other endpoints
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(path: str, request: Request):
    """명시되지 않은 Alert 서비스 경로를 모두 프록시합니다."""
    return await proxy_request(request, path)