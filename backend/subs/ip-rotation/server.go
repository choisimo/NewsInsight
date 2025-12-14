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

// ========== HTTP Handlers for IP Rotation ==========

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	stats := globalIPPool.GetPoolStats()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "ip-rotation",
		"stats":   stats,
	})
}

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

// handleProxyHealthCheck triggers an immediate health check
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

// handleProxyResetStats resets statistics
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

// handleProxySave saves the pool state to file
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

// handleProxyLoad loads the pool state from file
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

// handleGetNextProxy returns the next proxy (for client use)
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

// handleRecordResult records success or failure for a proxy
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

// corsMiddleware adds CORS headers
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

	log.Printf("[IP-ROTATION] Server starting on port %s", port)
	log.Printf("[IP-ROTATION] Config: strategy=%s maxFailures=%d cooldown=%dm",
		globalIPPool.config.Strategy, globalIPPool.config.MaxFailures, globalIPPool.config.CooldownMinutes)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("[IP-ROTATION] Server failed: %v", err)
	}
}
