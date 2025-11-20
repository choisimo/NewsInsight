package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	jwt "github.com/golang-jwt/jwt/v5"
	kafka "github.com/segmentio/kafka-go"
	"golang.org/x/crypto/bcrypt"
)

// In-memory stores (can be replaced by persistent storage later)
type Token struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresAt int64    `json:"expiresAt"`
	Revoked   bool     `json:"revoked"`
}

type Upstream struct {
	ID       string `json:"id"`
	BaseURL  string `json:"baseUrl"`
	Enabled  bool   `json:"enabled"`
	AuthMode string `json:"authMode"` // passthrough, strip, custom
	CustomAuthHeader string `json:"customAuthHeader"`
}

var (
	secretKey    = []byte(getEnv("ADMIN_JWT_SECRET", "change-me"))
	adminPort    = getEnv("ADMIN_PORT", "7080")
	defaultScope = "proxy:invoke"

	muTokens   sync.RWMutex
	muUpstream sync.RWMutex
	muConfig   sync.RWMutex

	tokens   = map[string]*Token{}
	upstreams = map[string]*Upstream{}

	// global config for proxy behavior
	config = struct {
		DefaultUpstream string `json:"defaultUpstream"`
		RequireAuth     bool   `json:"requireAuth"`
		AllowedModels   []string `json:"allowedModels"`
	}{
		DefaultUpstream: getEnv("OPENCODE_BASE", "http://opencode:7012"),
		RequireAuth:     false,
		AllowedModels:   []string{"gpt-4.1", "gpt-4o"},
	}

	globalStore *Store
)

func getEnv(k, d string) string { if v := os.Getenv(k); v != "" { return v }; return d }

// JWT Claims
type AdminClaims struct {
	TokenID string   `json:"tid"`
	Scopes  []string `json:"scopes"`
	jwt.RegisteredClaims
}

type AiRequestMessage struct {
	RequestID  string                 `json:"requestId"`
	Type       string                 `json:"type"`
	Query      string                 `json:"query"`
	Window     string                 `json:"window"`
	Message    string                 `json:"message"`
	Context    map[string]any         `json:"context"`
	ProviderID string                 `json:"providerId"`
	ModelID    string                 `json:"modelId"`
}

type AiResponseMessage struct {
	RequestID   string                 `json:"requestId"`
	Status      string                 `json:"status"`
	CompletedAt string                 `json:"completedAt"`
	ProviderID  string                 `json:"providerId"`
	ModelID     string                 `json:"modelId"`
	Text        string                 `json:"text"`
	Raw         map[string]any         `json:"raw"`
}

func main() {
	// Open persistent store (SQLite file path configurable)
	storePath := getEnv("ADMIN_DB_PATH", "data/proxy-admin.db")
	if _, err := os.Stat("data"); os.IsNotExist(err) { _ = os.MkdirAll("data", 0o755) }
	st, err := OpenStore(storePath)
	if err != nil {
		log.Printf("[proxy-admin] store open failed: %v (fallback to memory)", err)
	} else {
		// Seed bootstrap admin role/user/policies
		if err := st.SeedBootstrapAdmin(getEnv("ADMIN_EMAIL", "")); err != nil {
			log.Printf("[proxy-admin] seed error: %v", err)
		}
		// Optionally set admin password if provided via env
		if pw := getEnv("ADMIN_PASSWORD", ""); pw != "" {
			// ensure password row exists for the seeded admin user
			email := getEnv("ADMIN_EMAIL", "admin@example.com")
			if _, err := st.AuthenticateUser(email, pw); err != nil {
				// If user exists but password differs, reset it.
				if _, cerr := st.CreateUser(email, "Admin", pw); cerr != nil {
					// user likely exists: update password hash
					var uid int64
					if err := st.DB.QueryRow(`SELECT id FROM users WHERE email=?`, email).Scan(&uid); err == nil {
						h, herr := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
						if herr == nil {
							_, _ = st.DB.Exec(`INSERT INTO passwords(user_id,hash) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash`, uid, string(h))
						}
					}
				}
			}
		}
	}
	globalStore = st

	// Ensure upstream baseline
	muUpstream.Lock()
	upstreams["default"] = &Upstream{ID: "default", BaseURL: config.DefaultUpstream, Enabled: true, AuthMode: "passthrough"}
	muUpstream.Unlock()

	http.HandleFunc("/admin/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "db": st != nil}) })
	http.HandleFunc("/admin/config", withRBAC("config:write", "*", handleConfig))
	http.HandleFunc("/admin/token", withRBAC("token:*", "*", handleTokens))          // list & create
	http.HandleFunc("/admin/token/", withRBAC("token:*", "*", handleTokenByID))      // get, delete, edit
	http.HandleFunc("/admin/upstream", withRBAC("upstream:*", "*", handleUpstreams))    // list & create
	http.HandleFunc("/admin/upstream/", withRBAC("upstream:*", "*", handleUpstreamByID)) // get, delete, edit
	http.HandleFunc("/admin/login", handleLogin)
	http.HandleFunc("/proxy/auto-chat", handleProxyAutoChat)

	go startKafkaWorker()

	log.Printf("[proxy-admin] listening on :%s", adminPort)
	if err := http.ListenAndServe(":"+adminPort, nil); err != nil {
		log.Fatal(err)
	}
}

// Middleware-like helper
func withRBAC(action string, resource string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Allow GET reads on admin endpoints without RBAC for now, except when explicitly protected inside handler
		if r.Method == http.MethodGet {
			next(w, r); return
		}
		// Special-case: allow bootstrap token creation without auth when no tokens exist
		if r.URL.Path == "/admin/token" && r.Method == http.MethodPost {
			isEmpty := false
			if globalStore != nil {
				if list, err := globalStore.ListTokens(); err == nil && len(list) == 0 { isEmpty = true }
			} else {
				muTokens.RLock(); isEmpty = len(tokens) == 0; muTokens.RUnlock()
			}
			if isEmpty { next(w, r); return }
		}
		if globalStore == nil {
			// fallback to simple JWT-only check
			if _, err := authenticate(r, true); err != nil { writeErr(w, http.StatusUnauthorized, err); return }
			next(w, r); return
		}
		claims, err := authenticate(r, true)
		if err != nil { writeErr(w, http.StatusUnauthorized, err); return }
		// very simple: if admin:* scope is present, allow
		for _, s := range claims.Scopes { if s == "admin:*" { next(w, r); return } }
		// TODO: map token/user to subject; for now deny non-admin modifications
		writeErr(w, http.StatusForbidden, errors.New("forbidden"))
	}
}

func authenticate(r *http.Request, required bool) (*AdminClaims, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		if required { return nil, errors.New("missing Authorization") }
		return nil, nil
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") { return nil, errors.New("invalid auth header") }
	tokenStr := parts[1]
	token, err := jwt.ParseWithClaims(tokenStr, &AdminClaims{}, func(t *jwt.Token) (interface{}, error) { return secretKey, nil })
	if err != nil || !token.Valid { return nil, errors.New("invalid token") }
	claims, ok := token.Claims.(*AdminClaims)
	if !ok { return nil, errors.New("invalid claims") }
	// check revoked
	// check revoked using store if available; fallback to memory
	if globalStore != nil {
		if tk, err := globalStore.LoadToken(claims.TokenID); err != nil || tk == nil || tk.Revoked {
			return nil, errors.New("revoked or unknown token")
		}
		return claims, nil
	}
	muTokens.RLock(); defer muTokens.RUnlock()
	if tk, exists := tokens[claims.TokenID]; !exists || tk.Revoked { return nil, errors.New("revoked or unknown token") }
	return claims, nil
}

func issueToken(name string, scopes []string, ttlHours int) (*Token, string) {
	if len(scopes) == 0 { scopes = []string{defaultScope} }
	id := "tok_" + randomID()
	exp := time.Now().Add(time.Duration(ttlHours) * time.Hour).Unix()
	t := &Token{ID: id, Name: name, Scopes: scopes, ExpiresAt: exp}
	muTokens.Lock(); tokens[id] = t; muTokens.Unlock()
	if globalStore != nil {
		_ = globalStore.SaveToken(t, nil)
	}
	claims := AdminClaims{TokenID: id, Scopes: scopes, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Unix(exp,0)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	ss, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secretKey)
	return t, ss
}

// Handlers
func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed")); return }
	if globalStore == nil { writeErr(w, http.StatusServiceUnavailable, errors.New("no store configured")); return }
	var req struct{ Email, Password string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, http.StatusBadRequest, err); return }
	user, err := globalStore.AuthenticateUser(strings.TrimSpace(req.Email), req.Password)
	if err != nil { writeErr(w, http.StatusUnauthorized, err); return }
	// For admin UI, issue a short-lived admin JWT token
	exp := time.Now().Add(24 * time.Hour).Unix()
	scopes := []string{"admin:*"}
	claims := AdminClaims{TokenID: "user_" + intToString(user.ID), Scopes: scopes, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Unix(exp,0)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	ss, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secretKey)
	writeJSON(w, http.StatusOK, map[string]any{"jwt": ss, "user": user})
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		muConfig.RLock(); defer muConfig.RUnlock()
		writeJSON(w, http.StatusOK, config)
		return
	}
	if r.Method == http.MethodPatch {
		_, err := authenticate(r, true)
		if err != nil { writeErr(w, http.StatusUnauthorized, err); return }
		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil { writeErr(w, http.StatusBadRequest, err); return }
		muConfig.Lock(); defer muConfig.Unlock()
		if v, ok := patch["defaultUpstream"].(string); ok && v != "" { config.DefaultUpstream = v }
		if v, ok := patch["requireAuth"].(bool); ok { config.RequireAuth = v }
		if v, ok := patch["allowedModels"].([]any); ok { var ms []string; for _, x := range v { if s, ok := x.(string); ok { ms = append(ms, s) } }; if len(ms) > 0 { config.AllowedModels = ms } }
		writeJSON(w, http.StatusOK, config)
		return
	}
	writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}

func handleTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if globalStore != nil {
			list, err := globalStore.ListTokens()
			if err != nil { writeErr(w, http.StatusInternalServerError, err); return }
			writeJSON(w, http.StatusOK, list)
			return
		}
		muTokens.RLock(); defer muTokens.RUnlock()
		list := make([]*Token,0,len(tokens))
		for _, t := range tokens { list = append(list, t) }
		writeJSON(w, http.StatusOK, list)
	case http.MethodPost:
		// bootstrap if no tokens exist (store-aware)
		isEmpty := false
		if globalStore != nil {
			list, err := globalStore.ListTokens()
			if err == nil && len(list) == 0 { isEmpty = true }
		} else {
			muTokens.RLock(); isEmpty = len(tokens) == 0; muTokens.RUnlock()
		}
		if !isEmpty {
			if _, err := authenticate(r, true); err != nil { writeErr(w, http.StatusUnauthorized, err); return }
		}
		var req struct { Name string `json:"name"`; Scopes []string `json:"scopes"`; TTLHours int `json:"ttlHours"` }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, http.StatusBadRequest, err); return }
		if req.Name == "" { req.Name = "token" }
		if req.TTLHours <= 0 { req.TTLHours = 24 }
		t, raw := issueToken(req.Name, req.Scopes, req.TTLHours)
		writeJSON(w, http.StatusCreated, map[string]any{"token": t, "jwt": raw, "bootstrap": isEmpty})
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

func handleTokenByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/admin/token/")
	if id == "" { writeErr(w, http.StatusBadRequest, errors.New("missing id")); return }
	// store-aware operations
	if globalStore != nil {
		if r.Method == http.MethodGet {
			if t, err := globalStore.LoadToken(id); err == nil { writeJSON(w, http.StatusOK, t); return }
			writeErr(w, http.StatusNotFound, errors.New("not found")); return
		}
		if r.Method == http.MethodDelete || r.Method == http.MethodPatch {
			var t *Token
			if existing, err := globalStore.LoadToken(id); err == nil { t = existing }
			if t == nil { writeErr(w, http.StatusNotFound, errors.New("not found")); return }
			if r.Method == http.MethodDelete { t.Revoked = true } else {
				var patch map[string]any
				if err := json.NewDecoder(r.Body).Decode(&patch); err != nil { writeErr(w, http.StatusBadRequest, err); return }
				if v, ok := patch["name"].(string); ok { t.Name = v }
				if v, ok := patch["revoked"].(bool); ok { t.Revoked = v }
				if v, ok := patch["scopes"].([]any); ok { var sc []string; for _, x := range v { if s, ok := x.(string); ok { sc = append(sc, s) } }; if len(sc) > 0 { t.Scopes = sc } }
			}
			_ = globalStore.SaveToken(t, nil)
			writeJSON(w, http.StatusOK, t); return
		}
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed")); return
	}
	muTokens.Lock(); defer muTokens.Unlock()
	if r.Method == http.MethodGet {
		if t, ok := tokens[id]; ok { writeJSON(w, http.StatusOK, t); return }
		writeErr(w, http.StatusNotFound, errors.New("not found")); return
	}
	if r.Method == http.MethodDelete {
		if t, ok := tokens[id]; ok { t.Revoked = true; writeJSON(w, http.StatusOK, t); return }
		writeErr(w, http.StatusNotFound, errors.New("not found")); return
	}
	if r.Method == http.MethodPatch {
		var patch map[string]any
		if t, ok := tokens[id]; ok {
			if err := json.NewDecoder(r.Body).Decode(&patch); err != nil { writeErr(w, http.StatusBadRequest, err); return }
			if v, ok := patch["name"].(string); ok { t.Name = v }
			if v, ok := patch["revoked"].(bool); ok { t.Revoked = v }
			if v, ok := patch["scopes"].([]any); ok { var sc []string; for _, x := range v { if s, ok := x.(string); ok { sc = append(sc, s) } }; if len(sc) > 0 { t.Scopes = sc } }
			writeJSON(w, http.StatusOK, t); return
		}
		writeErr(w, http.StatusNotFound, errors.New("not found")); return
	}
	writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}

func handleUpstreams(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		muUpstream.RLock(); defer muUpstream.RUnlock()
		list := make([]*Upstream,0,len(upstreams))
		for _, u := range upstreams { list = append(list, u) }
		writeJSON(w, http.StatusOK, list)
	case http.MethodPost:
		_, err := authenticate(r, true)
		if err != nil { writeErr(w, http.StatusUnauthorized, err); return }
		var req Upstream
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, http.StatusBadRequest, err); return }
		if req.ID == "" { req.ID = "up_" + randomID() }
		if req.BaseURL == "" { writeErr(w, http.StatusBadRequest, errors.New("baseUrl required")); return }
		req.Enabled = true
		muUpstream.Lock(); upstreams[req.ID] = &req; muUpstream.Unlock()
		writeJSON(w, http.StatusCreated, req)
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

func handleUpstreamByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/admin/upstream/")
	if id == "" { writeErr(w, http.StatusBadRequest, errors.New("missing id")); return }
	muUpstream.Lock(); defer muUpstream.Unlock()
	if u, ok := upstreams[id]; ok {
		if r.Method == http.MethodGet { writeJSON(w, http.StatusOK, u); return }
		if r.Method == http.MethodDelete { delete(upstreams, id); writeJSON(w, http.StatusOK, map[string]string{"deleted": id}); return }
		if r.Method == http.MethodPatch {
			var patch map[string]any
			if err := json.NewDecoder(r.Body).Decode(&patch); err != nil { writeErr(w, http.StatusBadRequest, err); return }
			if v, ok := patch["baseUrl"].(string); ok { u.BaseURL = v }
			if v, ok := patch["enabled"].(bool); ok { u.Enabled = v }
			if v, ok := patch["authMode"].(string); ok { u.AuthMode = v }
			if v, ok := patch["customAuthHeader"].(string); ok { u.CustomAuthHeader = v }
			writeJSON(w, http.StatusOK, u); return
		}
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed")); return
	}
	writeErr(w, http.StatusNotFound, errors.New("not found"))
}

// Proxy endpoint replicating auto-chat behavior with model restriction & JWT
func handleProxyAutoChat(w http.ResponseWriter, r *http.Request) {
	// CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions { w.WriteHeader(http.StatusNoContent); return }
	if r.Method != http.MethodPost { writeErr(w, http.StatusNotFound, errors.New("use POST")); return }
	// auth if required
	if config.RequireAuth {
		if _, err := authenticate(r, true); err != nil { writeErr(w, http.StatusUnauthorized, err); return }
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil { writeErr(w, http.StatusBadRequest, err); return }
	// enforce model restrictions
	model := stringFromMap(payload, "modelID")
	if model == "" { model = stringFromMap(payload, "modelId") }
	if model == "" { model = stringFromMap(payload, "model") }
	if model != "" && !allowedModel(model) { writeErr(w, http.StatusBadRequest, errors.New("model not allowed")); return }
	msg := extractMessage(payload)
	if msg == "" { writeErr(w, http.StatusBadRequest, errors.New("message text required")); return }
	parts := partsFromPayload(payload, msg)
	if len(parts) == 0 { writeErr(w, http.StatusBadRequest, errors.New("message parts invalid")); return }

	// choose upstream
	muUpstream.RLock(); upstream := upstreams["default"]; muUpstream.RUnlock()
	if upstream == nil || !upstream.Enabled { writeErr(w, http.StatusBadGateway, errors.New("no upstream")); return }

	// Step 1 create session
	sessionURL := upstream.BaseURL + "/session"
	body1, _ := json.Marshal(map[string]string{"title": "Auto Session"})
	req1, _ := http.NewRequest(http.MethodPost, sessionURL, strings.NewReader(string(body1)))
	req1.Header.Set("Content-Type", "application/json")
	copyAuth(r, req1, upstream)
	resp1, err := http.DefaultClient.Do(req1)
	if err != nil { writeErr(w, http.StatusBadGateway, err); return }
	defer resp1.Body.Close()
	if resp1.StatusCode < 200 || resp1.StatusCode >= 300 { writeErrFromUpstream(w, resp1); return }
	var session map[string]any
	json.NewDecoder(resp1.Body).Decode(&session)
	sid := stringFromMap(session, "id")
	if sid == "" { writeErr(w, http.StatusBadGateway, errors.New("invalid session response")); return }

	// Step 2 send message
	messageURL := upstream.BaseURL + "/session/" + sid + "/message"
	bodyMsg, _ := json.Marshal(map[string]any{
		"providerID": stringFromMap(payload, "providerID", "openai"),
		"modelID":   modelOrDefault(model),
		"parts":     parts,
	})
	req2, _ := http.NewRequest(http.MethodPost, messageURL, strings.NewReader(string(bodyMsg)))
	req2.Header.Set("Content-Type", "application/json")
	copyAuth(r, req2, upstream)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil { writeErr(w, http.StatusBadGateway, err); return }
	defer resp2.Body.Close()
	if resp2.StatusCode < 200 || resp2.StatusCode >= 300 { writeErrFromUpstream(w, resp2); return }
	var final map[string]any
	if err := json.NewDecoder(resp2.Body).Decode(&final); err != nil {
		if !errors.Is(err, io.EOF) {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("upstream decode error: %w", err))
			return
		}
		final = nil
	}
	reply := extractResponseText(final)
	var sessionDetail map[string]any
	if reply == "" {
		if detail := fetchSessionDetail(r, upstream, sid); detail != nil {
			reply = extractResponseText(detail)
			if final == nil {
				final = detail
			}
			sessionDetail = detail
		}
	}
	result := map[string]any{"sessionId": sid, "response": final}
	if sessionDetail != nil { result["session"] = sessionDetail }
	if reply != "" { result["message"] = reply }
	writeJSON(w, http.StatusOK, result)
}

// Utilities
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func writeErrFromUpstream(w http.ResponseWriter, resp *http.Response) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("upstream %d read error: %w", resp.StatusCode, err))
		return
	}

	var decoded any
	if len(body) > 0 && json.Unmarshal(body, &decoded) == nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error":    "upstream error",
			"status":   resp.StatusCode,
			"upstream": decoded,
		})
		return
	}

	msg := strings.TrimSpace(string(body))
	if msg == "" {
		msg = fmt.Sprintf("upstream returned status %d", resp.StatusCode)
	}

	writeJSON(w, http.StatusBadGateway, map[string]any{
		"error":   "upstream error",
		"status":  resp.StatusCode,
		"message": msg,
	})
}

// Kafka worker: consume AI requests and call upstream OpenCode API
func startKafkaWorker() {
	brokersEnv := getEnv("KAFKA_BROKERS", "localhost:9092")
	brokers := strings.Split(brokersEnv, ",")
	reqTopic := getEnv("KAFKA_REQUEST_TOPIC", "newsinsight.ai.requests")
	groupID := getEnv("KAFKA_GROUP_ID", "ai-agent-worker")
	respTopic := getEnv("KAFKA_RESPONSE_TOPIC", "newsinsight.ai.responses")

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: brokers,
		Topic:   reqTopic,
		GroupID: groupID,
	})
	writer := &kafka.Writer{
		Addr:  kafka.TCP(brokers...),
		Topic: respTopic,
	}

	log.Printf("[kafka-worker] started brokers=%v topic=%s group=%s respTopic=%s", brokers, reqTopic, groupID, respTopic)
	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			log.Printf("[kafka-worker] read error: %v", err)
			continue
		}
		go handleAiKafkaMessage(msg, writer)
	}
}

func handleAiKafkaMessage(m kafka.Message, writer *kafka.Writer) {
	var req AiRequestMessage
	if err := json.Unmarshal(m.Value, &req); err != nil {
		log.Printf("[kafka-worker] invalid payload: %v", err)
		return
	}
	resp, err := processAiRequest(&req)
	if err != nil {
		log.Printf("[kafka-worker] process error for request %s: %v", req.RequestID, err)
		resp = &AiResponseMessage{
			RequestID:   req.RequestID,
			Status:      "FAILED",
			CompletedAt: time.Now().UTC().Format(time.RFC3339),
			ProviderID:  req.ProviderID,
			ModelID:     modelOrDefault(req.ModelID),
			Text:        err.Error(),
			Raw:         nil,
		}
	}
	payload, err := json.Marshal(resp)
	if err != nil {
		log.Printf("[kafka-worker] marshal error: %v", err)
		return
	}
	if err := writer.WriteMessages(context.Background(), kafka.Message{Key: []byte(resp.RequestID), Value: payload}); err != nil {
		log.Printf("[kafka-worker] write error for request %s: %v", resp.RequestID, err)
		return
	}
	log.Printf("[kafka-worker] processed request %s with status %s", resp.RequestID, resp.Status)
}

func processAiRequest(req *AiRequestMessage) (*AiResponseMessage, error) {
	model := req.ModelID
	if model == "" {
		model = modelOrDefault("")
	}
	if !allowedModel(model) {
		return nil, fmt.Errorf("model not allowed: %s", model)
	}

	muUpstream.RLock()
	upstream := upstreams["default"]
	muUpstream.Unlock()
	if upstream == nil || !upstream.Enabled {
		return nil, errors.New("no upstream")
	}

	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		msg = strings.TrimSpace(req.Query)
	}
	if msg == "" {
		return nil, errors.New("message text required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Step 1: create session
	sessionURL := upstream.BaseURL + "/session"
	body1, _ := json.Marshal(map[string]string{"title": "Auto Session"})
	req1, _ := http.NewRequestWithContext(ctx, http.MethodPost, sessionURL, strings.NewReader(string(body1)))
	req1.Header.Set("Content-Type", "application/json")
	if upstream.AuthMode == "custom" && upstream.CustomAuthHeader != "" {
		req1.Header.Set("Authorization", upstream.CustomAuthHeader)
	}
	resp1, err := http.DefaultClient.Do(req1)
	if err != nil {
		return nil, err
	}
	defer resp1.Body.Close()
	if resp1.StatusCode < 200 || resp1.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream session error: %d", resp1.StatusCode)
	}
	var session map[string]any
	if err := json.NewDecoder(resp1.Body).Decode(&session); err != nil {
		return nil, err
	}
	sid := stringFromMap(session, "id")
	if sid == "" {
		return nil, errors.New("invalid session response")
	}

	// Step 2: send message
	messageURL := upstream.BaseURL + "/session/" + sid + "/message"
	bodyMsg, _ := json.Marshal(map[string]any{
		"providerID": req.ProviderID,
		"modelID":   modelOrDefault(model),
		"parts":     []map[string]string{{"type": "text", "text": msg}},
	})
	req2, _ := http.NewRequestWithContext(ctx, http.MethodPost, messageURL, strings.NewReader(string(bodyMsg)))
	req2.Header.Set("Content-Type", "application/json")
	if upstream.AuthMode == "custom" && upstream.CustomAuthHeader != "" {
		req2.Header.Set("Authorization", upstream.CustomAuthHeader)
	}
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()
	if resp2.StatusCode < 200 || resp2.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream message error: %d", resp2.StatusCode)
	}
	var final map[string]any
	if err := json.NewDecoder(resp2.Body).Decode(&final); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("upstream decode error: %w", err)
	}
	reply := extractResponseText(final)
	return &AiResponseMessage{
		RequestID:   req.RequestID,
		Status:      "COMPLETED",
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		ProviderID:  req.ProviderID,
		ModelID:     model,
		Text:        reply,
		Raw:         final,
	}, nil
}

func randomID() string { return strings.ReplaceAll(time.Now().Format("150405.000000"), ".", "") }

func allowedModel(m string) bool {
	muConfig.RLock(); defer muConfig.RUnlock()
	for _, x := range config.AllowedModels { if x == m { return true } }
	return false
}

func stringFromMap(m map[string]any, keys ...string) string {
	if len(keys) == 0 { return "" }
	fallback := ""
	if len(keys) > 1 { fallback = keys[1] }
	k := keys[0]
	if v, ok := m[k]; ok {
		if s, ok2 := v.(string); ok2 { return s }
	}
	return fallback
}

func stringFromNestedParts(m map[string]any) string {
	if parts, ok := m["parts"].([]any); ok {
		for _, p := range parts {
			if mp, ok := p.(map[string]any); ok {
				if t, ok := mp["text"].(string); ok { return t }
			}
		}
	}
	return ""
}

func extractMessage(payload map[string]any) string {
	if msg := stringFromMap(payload, "message"); msg != "" { return msg }
	if msg := stringFromMap(payload, "text"); msg != "" { return msg }
	if msg := stringFromMap(payload, "content"); msg != "" { return msg }
	return stringFromNestedParts(payload)
}

func partsFromPayload(payload map[string]any, fallback string) []map[string]string {
	if raw, ok := payload["parts"]; ok {
		if arr, ok := raw.([]any); ok {
			var parts []map[string]string
			for _, item := range arr {
				mp, ok := item.(map[string]any)
				if !ok { continue }
				text := ""
				if v, ok := mp["text"].(string); ok { text = v } else if v, ok := mp["content"].(string); ok { text = v }
				if strings.TrimSpace(text) == "" { continue }
				typeVal := "text"
				if v, ok := mp["type"].(string); ok && v != "" { typeVal = v }
				parts = append(parts, map[string]string{"type": typeVal, "text": text})
			}
			if len(parts) > 0 { return parts }
		}
	}
	if strings.TrimSpace(fallback) == "" { return nil }
	return []map[string]string{{"type": "text", "text": fallback}}
}

func fetchSessionDetail(r *http.Request, upstream *Upstream, sid string) map[string]any {
	url := upstream.BaseURL + "/session/" + sid
	resp, err := makeUpstreamRequest(r, upstream, http.MethodGet, url, nil)
	if err != nil { return nil }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return nil }
	var detail map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil { return nil }
	return detail
}

func makeUpstreamRequest(src *http.Request, upstream *Upstream, method, url string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil { return nil, err }
	copyAuth(src, req, upstream)
	return http.DefaultClient.Do(req)
}

func extractResponseText(data map[string]any) string {
	if data == nil { return "" }
	if v, ok := data["message"].(string); ok && strings.TrimSpace(v) != "" { return v }
	if v, ok := data["text"].(string); ok && strings.TrimSpace(v) != "" { return v }
	if arr, ok := data["parts"].([]any); ok {
		var builder strings.Builder
		for _, item := range arr {
			if mp, ok := item.(map[string]any); ok {
				if txt, ok := mp["text"].(string); ok && strings.TrimSpace(txt) != "" {
					builder.WriteString(txt)
				}
			}
		}
		if builder.Len() > 0 { return builder.String() }
	}
	if arr, ok := data["messages"].([]any); ok {
		for i := len(arr) - 1; i >= 0; i-- {
			if mp, ok := arr[i].(map[string]any); ok {
				if txt, ok := mp["content"].(string); ok && strings.TrimSpace(txt) != "" {
					return txt
				}
				if parts, ok := mp["parts"].([]any); ok {
					for _, part := range parts {
						if mp2, ok := part.(map[string]any); ok {
							if txt, ok := mp2["text"].(string); ok && strings.TrimSpace(txt) != "" {
								return txt
							}
						}
					}
				}
			}
		}
	}
	return ""
}

func modelOrDefault(m string) string { if m == "" { return config.AllowedModels[0] }; return m }

func copyAuth(src *http.Request, dst *http.Request, upstream *Upstream) {
	auth := src.Header.Get("Authorization")
	switch upstream.AuthMode {
	case "passthrough":
		if headerHasToken(auth) { dst.Header.Set("Authorization", auth) }
	case "strip":
		// do nothing
	case "custom":
		if upstream.CustomAuthHeader != "" { dst.Header.Set("Authorization", upstream.CustomAuthHeader) }
	default:
		if auth != "" { dst.Header.Set("Authorization", auth) }
	}
}

// Helper: check if Authorization header contains a Bearer token
func headerHasToken(h string) bool {
	h = strings.TrimSpace(h)
	if h == "" { return false }
	parts := strings.SplitN(h, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && strings.TrimSpace(parts[1]) != "" {
		return true
	}
	return false
}
// Reverse proxy (optional future): not used directly yet
func buildReverseProxy(target string) (*httputil.ReverseProxy, error) {
	u, err := url.Parse(target)
	if err != nil { return nil, err }
	rx := httputil.NewSingleHostReverseProxy(u)
	rx.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) { writeErr(w, http.StatusBadGateway, e) }
	return rx, nil
}
