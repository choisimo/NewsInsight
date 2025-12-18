# ============================================================================
# NewsInsight - Kubernetes 배포 설정
# ============================================================================
# 
# 이 디렉토리에는 Kubernetes 환경에서 NewsInsight를 배포하기 위한 설정 파일이 포함됩니다.
#
# 사전 요구사항:
#   - Kubernetes 클러스터 (1.24+)
#   - KEDA (Kubernetes Event-driven Autoscaling) 2.0+
#   - Kafka/Redpanda 클러스터
#
# 설치 순서:
#   1. KEDA 설치:
#      helm repo add kedacore https://kedacore.github.io/charts
#      helm install keda kedacore/keda --namespace keda --create-namespace
#
#   2. Namespace 생성:
#      kubectl create namespace newsinsight
#
#   3. ConfigMap/Secret 적용:
#      kubectl apply -f configmap.yaml
#      kubectl apply -f secrets.yaml
#
#   4. 서비스 배포:
#      kubectl apply -f deployments/
#
#   5. KEDA ScaledObject 적용:
#      kubectl apply -f keda/
#
# 파일 구조:
#   etc/k8s/
#   ├── README.md                     # 이 파일
#   ├── namespace.yaml                # Namespace 정의
#   ├── configmap.yaml               # 공통 설정 (TODO)
#   ├── secrets.yaml                 # 시크릿 템플릿 (TODO)
#   ├── keda/
#   │   ├── autonomous-crawler-scaledobject.yaml   # 크롤러 오토스케일링
#   │   └── ai-agent-worker-scaledobject.yaml      # AI 에이전트 오토스케일링
#   └── deployments/ (TODO)
#       ├── api-gateway.yaml
#       ├── collector-service.yaml
#       └── ...
#
# 모니터링:
#   # KEDA 스케일링 상태 확인
#   kubectl get scaledobject -n newsinsight
#   kubectl describe scaledobject autonomous-crawler-scaler -n newsinsight
#
#   # HPA 상태 확인 (KEDA가 생성한 HPA)
#   kubectl get hpa -n newsinsight
