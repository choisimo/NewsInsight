package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ========== IP Rotation HTTP 핸들러 ==========

// writeJSON은 주어진 데이터를 JSON으로 인코딩하여 응답으로 반환합니다.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeErr는 에러를 JSON 형태로 응답합니다.
func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// handleHealth는 서비스 헬스체크 및 현재 프록시 풀 통계를 반환합니다.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	stats := globalIPPool.GetPoolStats()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "ip-rotation",
		"stats":   stats,
	})
}

// handleProxyPool은 프록시 풀 전체 조회/추가(관리자용)를 처리합니다.
func handleProxyPool(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		proxies := globalIPPool.GetAllProxies()
		stats := globalIPPool.GetPoolStats()
		writeJSON(w, http.StatusOK, map[string]any{
			"proxies": proxies,
			"stats":   stats,
		})
	case http.MethodPost:
		var proxy ProxyIP
		if err := json.NewDecoder(r.Body).Decode(&proxy); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := globalIPPool.AddProxy(&proxy); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, proxy)
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// handleProxyPoolByID는 특정 프록시 조회/삭제/부분 수정(관리자용)을 처리합니다.
func handleProxyPoolByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/admin/proxy-pool/")
	if id == "" {
		writeErr(w, http.StatusBadRequest, errors.New("missing proxy id"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		globalIPPool.mu.RLock()
		proxy, ok := globalIPPool.proxies[id]
		globalIPPool.mu.RUnlock()
		if !ok {
			writeErr(w, http.StatusNotFound, errors.New("proxy not found"))
			return
		}
		writeJSON(w, http.StatusOK, proxy)
	case http.MethodDelete:
		if err := globalIPPool.RemoveProxy(id); err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
	case http.MethodPatch:
		globalIPPool.mu.Lock()
		proxy, ok := globalIPPool.proxies[id]
		if !ok {
			globalIPPool.mu.Unlock()
			writeErr(w, http.StatusNotFound, errors.New("proxy not found"))
			return
		}
		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			globalIPPool.mu.Unlock()
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if v, ok := patch["enabled"].(bool); ok {
			proxy.Enabled = v
			if v {
				proxy.DisabledAt = time.Time{}
			} else {
				proxy.DisabledAt = time.Now()
			}
		}
		if v, ok := patch["address"].(string); ok && v != "" {
			proxy.Address = v
		}
		if v, ok := patch["country"].(string); ok {
			proxy.Country = v
		}
		if v, ok := patch["city"].(string); ok {
			proxy.City = v
		}
		if v, ok := patch["protocol"].(string); ok && v != "" {
			proxy.Protocol = v
		}
		if v, ok := patch["username"].(string); ok {
			proxy.Username = v
		}
		if v, ok := patch["password"].(string); ok {
			proxy.Password = v
		}
		// Handle success/failure recording
		if success, ok := patch["success"].(bool); ok && success {
			latency := int64(0)
			if v, ok := patch["latency_ms"].(float64); ok {
				latency = int64(v)
			}
			proxy.SuccessCount++
			total := proxy.SuccessCount + proxy.FailCount
			if total > 0 {
				proxy.AvgLatencyMs = (proxy.AvgLatencyMs*(total-1) + latency) / total
			}
		}
		if failure, ok := patch["failure"].(bool); ok && failure {
			proxy.FailCount++
			if globalIPPool.config.MaxFailures > 0 && proxy.FailCount >= int64(globalIPPool.config.MaxFailures) {
				proxy.Enabled = false
				proxy.DisabledAt = time.Now()
			}
		}
		globalIPPool.mu.Unlock()
		log.Printf("[IP-ROTATION] Proxy updated: id=%s enabled=%v", id, proxy.Enabled)

		// Auto-save
		globalIPPool.autoSave()

		writeJSON(w, http.StatusOK, proxy)
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// handleProxyPoolConfig는 풀 설정 조회/수정(관리자용)을 처리합니다.
func handleProxyPoolConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		globalIPPool.mu.RLock()
		cfg := globalIPPool.config
		globalIPPool.mu.RUnlock()
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPatch:
		var cfg IPPoolConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := globalIPPool.UpdateConfig(cfg); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// handleProxyRotateTest는 N회 로테이션을 수행해 선택 결과를 점검할 수 있는 테스트 API입니다.
func handleProxyRotateTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Count = 5 // default
	}
	if req.Count <= 0 {
		req.Count = 5
	}
	if req.Count > 100 {
		req.Count = 100
	}

	results := make([]map[string]any, 0, req.Count)

	for i := 0; i < req.Count; i++ {
		proxy, err := globalIPPool.GetNextProxy()
		if err != nil {
			results = append(results, map[string]any{
				"iteration": i + 1,
				"error":     err.Error(),
			})
			continue
		}
		results = append(results, map[string]any{
			"iteration":    i + 1,
			"proxyId":      proxy.ID,
			"address":      proxy.Address,
			"protocol":     proxy.Protocol,
			"country":      proxy.Country,
			"usageCount":   proxy.UsageCount,
			"successRate":  fmt.Sprintf("%.2f%%", calculateSuccessRate(proxy)),
			"healthStatus": proxy.HealthStatus,
		})
	}

	stats := globalIPPool.GetPoolStats()

	log.Printf("[IP-ROTATION] Rotation test completed: count=%d", req.Count)

	writeJSON(w, http.StatusOK, map[string]any{
		"rotations": results,
		"stats":     stats,
	})
}

// handleProxyHealthCheck는 즉시 헬스체크를 수행하도록 트리거합니다.
func handleProxyHealthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	globalIPPool.RunHealthCheckNow()
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "started",
		"message": "Health check started in background",
	})
}

// handleProxyResetStats는 전체 또는 특정 프록시의 통계를 초기화합니다.
func handleProxyResetStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		ProxyID string `json:"proxyId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ProxyID == "" {
		// Reset all
		globalIPPool.ResetStats()
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "success",
			"message": "All proxy statistics reset",
		})
		return
	}

	if err := globalIPPool.ResetProxyStats(req.ProxyID); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("Statistics reset for proxy: %s", req.ProxyID),
	})
}

// handleProxySave는 현재 풀 상태를 파일로 저장합니다.
func handleProxySave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	path := req.Path
	if path == "" {
		globalIPPool.mu.RLock()
		path = globalIPPool.config.PersistencePath
		globalIPPool.mu.RUnlock()
	}
	if path == "" {
		path = "ip_pool_state.json"
	}

	if err := globalIPPool.SaveToFile(path); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("Pool state saved to: %s", path),
	})
}

// handleProxyLoad는 파일에서 풀 상태를 로드합니다.
func handleProxyLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	path := req.Path
	if path == "" {
		globalIPPool.mu.RLock()
		path = globalIPPool.config.PersistencePath
		globalIPPool.mu.RUnlock()
	}
	if path == "" {
		path = "ip_pool_state.json"
	}

	if err := globalIPPool.LoadFromFile(path); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("Pool state loaded from: %s", path),
	})
}

// handleGetNextProxy는 다음 프록시를 반환합니다(클라이언트/크롤러용).
func handleGetNextProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use GET or POST"))
		return
	}

	proxy, err := globalIPPool.GetNextProxy()
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"proxyId":      proxy.ID,
		"address":      proxy.Address,
		"protocol":     proxy.Protocol,
		"username":     proxy.Username,
		"password":     proxy.Password,
		"country":      proxy.Country,
		"healthStatus": proxy.HealthStatus,
	})
}

// handleRecordResult는 프록시의 성공/실패 결과를 기록합니다(클라이언트/크롤러용).
func handleRecordResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		ProxyID   string `json:"proxyId"`
		Success   bool   `json:"success"`
		LatencyMs int64  `json:"latencyMs"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	if req.ProxyID == "" {
		writeErr(w, http.StatusBadRequest, errors.New("proxyId is required"))
		return
	}

	if req.Success {
		globalIPPool.RecordSuccess(req.ProxyID, req.LatencyMs)
	} else {
		globalIPPool.RecordFailure(req.ProxyID, req.Reason)
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "recorded",
	})
}

// handleRecordCaptcha는 프록시의 CAPTCHA 발생을 기록합니다(클라이언트/크롤러용).
func handleRecordCaptcha(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}

	var req struct {
		ProxyID string `json:"proxyId"`
		Type    string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	if req.ProxyID == "" {
		writeErr(w, http.StatusBadRequest, errors.New("proxyId is required"))
		return
	}

	globalIPPool.RecordCaptcha(req.ProxyID, req.Type)

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "recorded",
	})
}

// corsMiddleware는 CORS 헤더를 추가하고 OPTIONS 프리플라이트 요청을 처리합니다.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// main은 환경 변수 기반으로 IP 풀을 초기화하고 HTTP 서버를 시작합니다.
func main() {
	// Initialize the IP pool
	initIPPool()

	// Get port from environment
	port := os.Getenv("PORT")
	if port == "" {
		port = "8050"
	}

	// Register routes
	http.HandleFunc("/health", corsMiddleware(handleHealth))

	// Admin endpoints
	http.HandleFunc("/admin/proxy-pool", corsMiddleware(handleProxyPool))
	http.HandleFunc("/admin/proxy-pool/", corsMiddleware(handleProxyPoolByID))
	http.HandleFunc("/admin/proxy-pool-config", corsMiddleware(handleProxyPoolConfig))
	http.HandleFunc("/admin/proxy-rotate-test", corsMiddleware(handleProxyRotateTest))
	http.HandleFunc("/admin/proxy-health-check", corsMiddleware(handleProxyHealthCheck))
	http.HandleFunc("/admin/proxy-reset-stats", corsMiddleware(handleProxyResetStats))
	http.HandleFunc("/admin/proxy-save", corsMiddleware(handleProxySave))
	http.HandleFunc("/admin/proxy-load", corsMiddleware(handleProxyLoad))

	// Client endpoints (for crawlers to use)
	http.HandleFunc("/proxy/next", corsMiddleware(handleGetNextProxy))
	http.HandleFunc("/proxy/record", corsMiddleware(handleRecordResult))
	http.HandleFunc("/proxy/captcha", corsMiddleware(handleRecordCaptcha))

	log.Printf("[IP-ROTATION] Server starting on port %s", port)
	log.Printf("[IP-ROTATION] Config: strategy=%s maxFailures=%d cooldown=%dm",
		globalIPPool.config.Strategy, globalIPPool.config.MaxFailures, globalIPPool.config.CooldownMinutes)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("[IP-ROTATION] Server failed: %v", err)
	}
}
