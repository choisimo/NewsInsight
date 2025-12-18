package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ProxyIP는 단일 프록시 설정과 통계 정보를 나타냅니다.
type ProxyIP struct {
	ID              string    `json:"id"`
	Address         string    `json:"address"`  // e.g., "http://proxy.example.com:8080" or "socks5://10.0.0.1:1080"
	Protocol        string    `json:"protocol"` // http, https, socks4, socks5
	Username        string    `json:"username,omitempty"`
	Password        string    `json:"password,omitempty"`
	Country         string    `json:"country,omitempty"`
	City            string    `json:"city,omitempty"`
	Enabled         bool      `json:"enabled"`
	UsageCount      int64     `json:"usageCount"`
	LastUsed        time.Time `json:"lastUsed,omitempty"`
	SuccessCount    int64     `json:"successCount"`
	FailCount       int64     `json:"failCount"`
	CaptchaCount    int64     `json:"captchaCount"`
	AvgLatencyMs    int64     `json:"avgLatencyMs"`
	CreatedAt       time.Time `json:"createdAt"`
	DisabledAt      time.Time `json:"disabledAt,omitempty"` // When proxy was auto-disabled
	LastHealthCheck time.Time `json:"lastHealthCheck,omitempty"`
	HealthStatus    string    `json:"healthStatus,omitempty"` // healthy, unhealthy, unknown
}

// RotationStrategy는 프록시 선택(로테이션) 전략을 정의합니다.
type RotationStrategy string

const (
	StrategyRoundRobin RotationStrategy = "round_robin"
	StrategyRandom     RotationStrategy = "random"
	StrategyLeastUsed  RotationStrategy = "least_used"
	StrategyWeighted   RotationStrategy = "weighted"   // based on success rate
	StrategyGeographic RotationStrategy = "geographic" // based on country/region
)

// validStrategies는 RotationStrategy 값 검증에 사용되는 허용 목록입니다.
var validStrategies = map[RotationStrategy]bool{
	StrategyRoundRobin: true,
	StrategyRandom:     true,
	StrategyLeastUsed:  true,
	StrategyWeighted:   true,
	StrategyGeographic: true,
}

// IPPoolConfig는 IP 풀의 동작(전략/쿨다운/헬스체크/영속화) 설정을 담습니다.
type IPPoolConfig struct {
	Strategy            RotationStrategy `json:"strategy"`
	MaxFailures         int              `json:"maxFailures"`     // auto-disable after N failures
	CooldownMinutes     int              `json:"cooldownMinutes"` // re-enable after cooldown
	PreferredCountry    string           `json:"preferredCountry,omitempty"`
	HealthCheckInterval int              `json:"healthCheckInterval"`       // seconds between health checks
	HealthCheckTimeout  int              `json:"healthCheckTimeout"`        // seconds for health check timeout
	PersistencePath     string           `json:"persistencePath,omitempty"` // path to save/load pool state
}

// Validate는 IPPoolConfig 값이 유효한지 검사하고, 잘못된 설정이면 오류를 반환합니다.
func (c *IPPoolConfig) Validate() error {
	if c.Strategy != "" && !validStrategies[c.Strategy] {
		return fmt.Errorf("invalid strategy: %s, must be one of: round_robin, random, least_used, weighted, geographic", c.Strategy)
	}
	if c.MaxFailures < 0 {
		return errors.New("maxFailures must be non-negative")
	}
	if c.CooldownMinutes < 0 {
		return errors.New("cooldownMinutes must be non-negative")
	}
	if c.HealthCheckInterval < 0 {
		return errors.New("healthCheckInterval must be non-negative")
	}
	if c.HealthCheckTimeout < 0 {
		return errors.New("healthCheckTimeout must be non-negative")
	}
	return nil
}

// IPPoolState는 IP 풀의 상태를 파일에 저장/복원하기 위한 직렬화 구조체입니다.
type IPPoolState struct {
	Proxies map[string]*ProxyIP `json:"proxies"`
	Order   []string            `json:"order"`
	Index   int                 `json:"index"`
	Config  IPPoolConfig        `json:"config"`
	SavedAt time.Time           `json:"savedAt"`
}

// IPPool은 프록시 풀을 관리하고 로테이션/통계/헬스체크/영속화를 제공합니다.
type IPPool struct {
	mu                 sync.RWMutex
	proxies            map[string]*ProxyIP
	order              []string // for round-robin
	index              int      // current index for round-robin
	config             IPPoolConfig
	cooldownTicker     *time.Ticker
	healthCheckTicker  *time.Ticker
	stopCooldown       chan struct{}
	stopHealthCheck    chan struct{}
	cooldownRunning    bool
	healthCheckRunning bool
}

var (
	globalIPPool *IPPool
	muIPPool     sync.RWMutex
)

// initIPPool은 환경 변수 기반 설정을 읽어 전역 IP 풀을 초기화합니다.
func initIPPool() {
	// Get config from environment
	strategy := RotationStrategy(os.Getenv("STRATEGY"))
	if strategy == "" {
		strategy = StrategyRoundRobin
	}

	maxFailures := 5
	if v := os.Getenv("MAX_FAILURES"); v != "" {
		fmt.Sscanf(v, "%d", &maxFailures)
	}

	cooldownMinutes := 30
	if v := os.Getenv("COOLDOWN_MINUTES"); v != "" {
		fmt.Sscanf(v, "%d", &cooldownMinutes)
	}

	healthCheckInterval := 300
	if v := os.Getenv("HEALTH_CHECK_INTERVAL"); v != "" {
		fmt.Sscanf(v, "%d", &healthCheckInterval)
	}

	persistencePath := os.Getenv("PERSISTENCE_PATH")

	globalIPPool = NewIPPool(IPPoolConfig{
		Strategy:            strategy,
		MaxFailures:         maxFailures,
		CooldownMinutes:     cooldownMinutes,
		HealthCheckInterval: healthCheckInterval,
		HealthCheckTimeout:  10,
		PersistencePath:     persistencePath,
	})

	// Load existing state if persistence path is set
	if persistencePath != "" {
		if err := globalIPPool.LoadFromFile(persistencePath); err != nil {
			log.Printf("[IP-ROTATION] Failed to load state: %v", err)
		}
	}
}

// NewIPPool은 주어진 설정으로 IPPool을 생성하고, 필요 시 쿨다운/헬스체크 루틴을 시작합니다.
func NewIPPool(config IPPoolConfig) *IPPool {
	pool := &IPPool{
		proxies:         make(map[string]*ProxyIP),
		order:           make([]string, 0),
		index:           0,
		config:          config,
		stopCooldown:    make(chan struct{}),
		stopHealthCheck: make(chan struct{}),
	}

	// Start cooldown checker if cooldown is configured
	if config.CooldownMinutes > 0 {
		pool.StartCooldownChecker()
	}

	// Start health checker if configured
	if config.HealthCheckInterval > 0 {
		pool.StartHealthChecker()
	}

	return pool
}

// StartCooldownChecker는 쿨다운 이후 프록시를 자동 재활성화하는 백그라운드 루틴을 시작합니다.
func (p *IPPool) StartCooldownChecker() {
	p.mu.Lock()
	if p.cooldownRunning {
		p.mu.Unlock()
		return
	}
	p.cooldownRunning = true
	// Check every minute for cooldown expiry
	p.cooldownTicker = time.NewTicker(1 * time.Minute)
	p.mu.Unlock()

	go func() {
		log.Printf("[IP-ROTATION] Cooldown checker started (cooldown=%d minutes)", p.config.CooldownMinutes)
		for {
			select {
			case <-p.cooldownTicker.C:
				p.checkAndReenableProxies()
			case <-p.stopCooldown:
				p.cooldownTicker.Stop()
				log.Printf("[IP-ROTATION] Cooldown checker stopped")
				return
			}
		}
	}()
}

// StopCooldownChecker는 쿨다운 체크 백그라운드 루틴을 중지합니다.
func (p *IPPool) StopCooldownChecker() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cooldownRunning {
		close(p.stopCooldown)
		p.cooldownRunning = false
		p.stopCooldown = make(chan struct{})
	}
}

// checkAndReenableProxies는 비활성화된 프록시의 쿨다운 만료 여부를 확인하고 재활성화합니다.
func (p *IPPool) checkAndReenableProxies() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.config.CooldownMinutes <= 0 {
		return
	}

	cooldownDuration := time.Duration(p.config.CooldownMinutes) * time.Minute
	now := time.Now()

	for id, proxy := range p.proxies {
		if !proxy.Enabled && !proxy.DisabledAt.IsZero() {
			if now.Sub(proxy.DisabledAt) >= cooldownDuration {
				proxy.Enabled = true
				proxy.FailCount = 0 // Reset fail count on re-enable
				proxy.DisabledAt = time.Time{}
				log.Printf("[IP-ROTATION] Proxy re-enabled after cooldown: id=%s addr=%s", id, proxy.Address)
			}
		}
	}
}

// StartHealthChecker는 주기적으로 프록시 가용성을 점검하는 헬스체크 루틴을 시작합니다.
func (p *IPPool) StartHealthChecker() {
	p.mu.Lock()
	if p.healthCheckRunning {
		p.mu.Unlock()
		return
	}
	p.healthCheckRunning = true
	interval := p.config.HealthCheckInterval
	if interval <= 0 {
		interval = 300 // default 5 minutes
	}
	p.healthCheckTicker = time.NewTicker(time.Duration(interval) * time.Second)
	p.mu.Unlock()

	go func() {
		log.Printf("[IP-ROTATION] Health checker started (interval=%d seconds)", interval)
		for {
			select {
			case <-p.healthCheckTicker.C:
				p.runHealthChecks()
			case <-p.stopHealthCheck:
				p.healthCheckTicker.Stop()
				log.Printf("[IP-ROTATION] Health checker stopped")
				return
			}
		}
	}()
}

// StopHealthChecker는 헬스체크 백그라운드 루틴을 중지합니다.
func (p *IPPool) StopHealthChecker() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.healthCheckRunning {
		close(p.stopHealthCheck)
		p.healthCheckRunning = false
		p.stopHealthCheck = make(chan struct{})
	}
}

// runHealthChecks는 활성화된 프록시들에 대해 병렬 헬스체크를 수행하고 상태를 업데이트합니다.
func (p *IPPool) runHealthChecks() {
	p.mu.RLock()
	proxiesToCheck := make([]*ProxyIP, 0)
	for _, proxy := range p.proxies {
		if proxy.Enabled {
			proxiesToCheck = append(proxiesToCheck, proxy)
		}
	}
	timeout := p.config.HealthCheckTimeout
	if timeout <= 0 {
		timeout = 10
	}
	p.mu.RUnlock()

	var wg sync.WaitGroup
	for _, proxy := range proxiesToCheck {
		wg.Add(1)
		go func(px *ProxyIP) {
			defer wg.Done()
			healthy := p.checkProxyHealth(px, time.Duration(timeout)*time.Second)
			p.mu.Lock()
			px.LastHealthCheck = time.Now()
			if healthy {
				px.HealthStatus = "healthy"
			} else {
				px.HealthStatus = "unhealthy"
			}
			p.mu.Unlock()
		}(proxy)
	}
	wg.Wait()
	log.Printf("[IP-ROTATION] Health check completed for %d proxies", len(proxiesToCheck))
}

// checkProxyHealth는 프록시 호스트에 TCP 연결을 시도하여 도달 가능 여부를 반환합니다.
func (p *IPPool) checkProxyHealth(proxy *ProxyIP, timeout time.Duration) bool {
	proxyURL, err := proxy.GetProxyURL()
	if err != nil {
		return false
	}

	// Extract host:port from proxy URL
	host := proxyURL.Host
	if host == "" {
		return false
	}

	conn, err := net.DialTimeout("tcp", host, timeout)
	if err != nil {
		log.Printf("[IP-ROTATION] Health check failed for %s: %v", proxy.ID, err)
		return false
	}
	conn.Close()
	return true
}

// RunHealthCheckNow는 즉시 헬스체크를 비동기로 트리거합니다.
func (p *IPPool) RunHealthCheckNow() {
	go p.runHealthChecks()
}

// GetNextProxy는 설정된 로테이션 전략에 따라 다음 프록시를 선택하고 사용 통계를 갱신합니다.
func (p *IPPool) GetNextProxy() (*ProxyIP, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	enabledProxies := p.getEnabledProxies()
	if len(enabledProxies) == 0 {
		return nil, errors.New("no enabled proxies available")
	}

	var selected *ProxyIP

	switch p.config.Strategy {
	case StrategyRoundRobin:
		selected = p.selectRoundRobin(enabledProxies)
	case StrategyRandom:
		selected = p.selectRandom(enabledProxies)
	case StrategyLeastUsed:
		selected = p.selectLeastUsed(enabledProxies)
	case StrategyWeighted:
		selected = p.selectWeighted(enabledProxies)
	case StrategyGeographic:
		selected = p.selectGeographic(enabledProxies)
	default:
		selected = p.selectRoundRobin(enabledProxies)
	}

	if selected != nil {
		selected.UsageCount++
		selected.LastUsed = time.Now()
		log.Printf("[IP-ROTATION] Selected proxy: id=%s addr=%s strategy=%s usage_count=%d",
			selected.ID, selected.Address, p.config.Strategy, selected.UsageCount)
	}

	return selected, nil
}

// getEnabledProxies는 Enabled=true인 프록시 목록을 반환합니다.
func (p *IPPool) getEnabledProxies() []*ProxyIP {
	var enabled []*ProxyIP
	for _, proxy := range p.proxies {
		if proxy.Enabled {
			enabled = append(enabled, proxy)
		}
	}
	return enabled
}

// selectRoundRobin은 라운드로빈 순서(order)를 기준으로 다음 사용 가능한 프록시를 선택합니다.
func (p *IPPool) selectRoundRobin(proxies []*ProxyIP) *ProxyIP {
	if len(proxies) == 0 {
		return nil
	}
	// Find valid index
	if p.index >= len(p.order) {
		p.index = 0
	}

	// Try to find next enabled proxy
	attempts := 0
	for attempts < len(p.order) {
		if p.index >= len(p.order) {
			p.index = 0
		}
		id := p.order[p.index]
		p.index++
		if proxy, ok := p.proxies[id]; ok && proxy.Enabled {
			return proxy
		}
		attempts++
	}

	// Fallback to first enabled
	if len(proxies) > 0 {
		return proxies[0]
	}
	return nil
}

// secureRandomInt는 crypto/rand를 사용해 [0, max) 범위의 난수를 생성합니다.
func secureRandomInt(max int) int {
	if max <= 0 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max)))
	if err != nil {
		// Fallback to time-based (should not happen)
		return int(time.Now().UnixNano()) % max
	}
	return int(n.Int64())
}

// selectRandom은 사용 가능한 프록시 중 하나를 무작위로 선택합니다.
func (p *IPPool) selectRandom(proxies []*ProxyIP) *ProxyIP {
	if len(proxies) == 0 {
		return nil
	}
	idx := secureRandomInt(len(proxies))
	return proxies[idx]
}

// selectLeastUsed는 UsageCount가 가장 낮은 프록시를 선택합니다.
func (p *IPPool) selectLeastUsed(proxies []*ProxyIP) *ProxyIP {
	if len(proxies) == 0 {
		return nil
	}
	min := proxies[0]
	for _, proxy := range proxies[1:] {
		if proxy.UsageCount < min.UsageCount {
			min = proxy
		}
	}
	return min
}

// selectWeighted는 성공률과 CAPTCHA 패널티 기반 가중치 랜덤 선택으로 프록시를 선택합니다.
func (p *IPPool) selectWeighted(proxies []*ProxyIP) *ProxyIP {
	if len(proxies) == 0 {
		return nil
	}

	// Calculate weights based on success rate
	// Use a minimum weight to give all proxies some chance
	const minWeight = 10.0
	weights := make([]float64, len(proxies))
	totalWeight := 0.0

	for i, proxy := range proxies {
		total := proxy.SuccessCount + proxy.FailCount
		var baseWeight float64
		if total == 0 {
			// New proxy gets a neutral weight (50% success assumed + exploration bonus)
			baseWeight = 50.0 + minWeight
		} else {
			rate := float64(proxy.SuccessCount) / float64(total) * 100
			baseWeight = rate + minWeight
		}

		captchaRate := float64(proxy.CaptchaCount) / float64(proxy.UsageCount+1)
		captchaPenalty := 1.0 - (captchaRate * 0.7)
		if captchaPenalty < 0.1 {
			captchaPenalty = 0.1
		}

		weight := baseWeight * captchaPenalty
		if weight < minWeight {
			weight = minWeight
		}
		weights[i] = weight
		totalWeight += weight
	}

	if totalWeight <= 0 {
		return proxies[secureRandomInt(len(proxies))]
	}

	// Generate random value in [0, totalWeight)
	randN, err := rand.Int(rand.Reader, big.NewInt(int64(totalWeight*1000)))
	if err != nil {
		// Fallback
		return proxies[secureRandomInt(len(proxies))]
	}
	randVal := float64(randN.Int64()) / 1000.0

	// Select based on cumulative weight
	cumulative := 0.0
	for i, weight := range weights {
		cumulative += weight
		if randVal < cumulative {
			return proxies[i]
		}
	}

	// Fallback to last proxy
	return proxies[len(proxies)-1]
}

// selectGeographic은 선호 국가 설정이 있으면 해당 국가 프록시를 우선 선택하고, 없으면 라운드로빈으로 폴백합니다.
func (p *IPPool) selectGeographic(proxies []*ProxyIP) *ProxyIP {
	if len(proxies) == 0 {
		return nil
	}
	// Prefer proxies matching configured country
	if p.config.PreferredCountry != "" {
		var matchingProxies []*ProxyIP
		for _, proxy := range proxies {
			if strings.EqualFold(proxy.Country, p.config.PreferredCountry) {
				matchingProxies = append(matchingProxies, proxy)
			}
		}
		if len(matchingProxies) > 0 {
			// Use round-robin among matching proxies
			return matchingProxies[secureRandomInt(len(matchingProxies))]
		}
	}
	// Fallback to round-robin
	return p.selectRoundRobin(proxies)
}

// RecordSuccess는 특정 프록시의 성공 결과와 평균 지연시간을 기록합니다.
func (p *IPPool) RecordSuccess(proxyID string, latencyMs int64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if proxy, ok := p.proxies[proxyID]; ok {
		proxy.SuccessCount++
		// Update average latency
		total := proxy.SuccessCount + proxy.FailCount
		if total > 0 {
			proxy.AvgLatencyMs = (proxy.AvgLatencyMs*(total-1) + latencyMs) / total
		}
		log.Printf("[IP-ROTATION] Success recorded: id=%s success=%d fail=%d latency=%dms",
			proxyID, proxy.SuccessCount, proxy.FailCount, latencyMs)
	}
}

// RecordCaptcha는 특정 프록시에 CAPTCHA 발생을 기록하여 선택 가중치에 반영될 수 있도록 합니다.
func (p *IPPool) RecordCaptcha(proxyID string, captchaType string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if proxy, ok := p.proxies[proxyID]; ok {
		proxy.CaptchaCount++
		log.Printf("[IP-ROTATION] CAPTCHA recorded: id=%s count=%d type=%s",
			proxyID, proxy.CaptchaCount, captchaType)
	}
}

// RecordFailure는 특정 프록시의 실패를 기록하고, 임계치 초과 시 자동으로 비활성화합니다.
func (p *IPPool) RecordFailure(proxyID string, reason string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if proxy, ok := p.proxies[proxyID]; ok {
		proxy.FailCount++
		log.Printf("[IP-ROTATION] Failure recorded: id=%s success=%d fail=%d reason=%s",
			proxyID, proxy.SuccessCount, proxy.FailCount, reason)

		// Auto-disable if too many failures
		if p.config.MaxFailures > 0 && proxy.FailCount >= int64(p.config.MaxFailures) {
			proxy.Enabled = false
			proxy.DisabledAt = time.Now()
			log.Printf("[IP-ROTATION] Proxy auto-disabled due to failures: id=%s (will re-enable after %d minutes)",
				proxyID, p.config.CooldownMinutes)
		}
	}
}

// AddProxy는 프록시를 풀에 추가하고 형식/프로토콜을 검증한 뒤 기본값을 설정합니다.
func (p *IPPool) AddProxy(proxy *ProxyIP) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if proxy.ID == "" {
		proxy.ID = "proxy_" + randomID()
	}
	if proxy.Address == "" {
		return errors.New("proxy address is required")
	}

	// Validate proxy address format
	if _, err := url.Parse(proxy.Address); err != nil {
		return fmt.Errorf("invalid proxy address format: %w", err)
	}

	if proxy.Protocol == "" {
		proxy.Protocol = "http"
	}

	// Validate protocol
	validProtocols := map[string]bool{"http": true, "https": true, "socks4": true, "socks5": true}
	if !validProtocols[strings.ToLower(proxy.Protocol)] {
		return fmt.Errorf("invalid protocol: %s, must be one of: http, https, socks4, socks5", proxy.Protocol)
	}
	proxy.Protocol = strings.ToLower(proxy.Protocol)

	proxy.CreatedAt = time.Now()
	proxy.Enabled = true
	proxy.HealthStatus = "unknown"

	p.proxies[proxy.ID] = proxy
	p.order = append(p.order, proxy.ID)

	log.Printf("[IP-ROTATION] Proxy added: id=%s addr=%s protocol=%s country=%s",
		proxy.ID, proxy.Address, proxy.Protocol, proxy.Country)

	// Auto-save if persistence is configured
	p.autoSave()

	return nil
}

// RemoveProxy는 풀에서 프록시를 제거하고 라운드로빈 순서도 갱신합니다.
func (p *IPPool) RemoveProxy(id string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.proxies[id]; !ok {
		return errors.New("proxy not found")
	}

	delete(p.proxies, id)

	// Remove from order
	for i, oid := range p.order {
		if oid == id {
			p.order = append(p.order[:i], p.order[i+1:]...)
			break
		}
	}

	log.Printf("[IP-ROTATION] Proxy removed: id=%s", id)

	// Auto-save if persistence is configured
	p.autoSave()

	return nil
}

// GetAllProxies는 풀에 등록된 모든 프록시 목록을 반환합니다.
func (p *IPPool) GetAllProxies() []*ProxyIP {
	p.mu.RLock()
	defer p.mu.RUnlock()

	proxies := make([]*ProxyIP, 0, len(p.proxies))
	for _, proxy := range p.proxies {
		proxies = append(proxies, proxy)
	}
	return proxies
}

// GetPoolStats는 풀 전체의 통계를 집계하여 반환합니다.
func (p *IPPool) GetPoolStats() map[string]any {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var totalUsage, totalSuccess, totalFail, totalCaptcha int64
	enabledCount := 0
	disabledCount := 0
	healthyCount := 0
	unhealthyCount := 0

	for _, proxy := range p.proxies {
		totalUsage += proxy.UsageCount
		totalSuccess += proxy.SuccessCount
		totalFail += proxy.FailCount
		totalCaptcha += proxy.CaptchaCount
		if proxy.Enabled {
			enabledCount++
		} else {
			disabledCount++
		}
		switch proxy.HealthStatus {
		case "healthy":
			healthyCount++
		case "unhealthy":
			unhealthyCount++
		}
	}

	successRate := float64(0)
	if totalSuccess+totalFail > 0 {
		successRate = float64(totalSuccess) / float64(totalSuccess+totalFail) * 100
	}

	captchaRate := float64(0)
	if totalUsage > 0 {
		captchaRate = float64(totalCaptcha) / float64(totalUsage) * 100
	}

	return map[string]any{
		"totalProxies":     len(p.proxies),
		"enabledProxies":   enabledCount,
		"disabledProxies":  disabledCount,
		"healthyProxies":   healthyCount,
		"unhealthyProxies": unhealthyCount,
		"totalUsage":       totalUsage,
		"totalSuccess":     totalSuccess,
		"totalFail":        totalFail,
		"totalCaptcha":     totalCaptcha,
		"successRate":      fmt.Sprintf("%.2f%%", successRate),
		"captchaRate":      fmt.Sprintf("%.2f%%", captchaRate),
		"strategy":         p.config.Strategy,
		"currentIndex":     p.index,
		"cooldownMinutes":  p.config.CooldownMinutes,
		"maxFailures":      p.config.MaxFailures,
	}
}

// UpdateConfig는 설정을 검증 후 적용하고, 변경 사항에 따라 백그라운드 루틴을 재시작합니다.
func (p *IPPool) UpdateConfig(cfg IPPoolConfig) error {
	if err := cfg.Validate(); err != nil {
		return err
	}

	p.mu.Lock()
	oldCooldown := p.config.CooldownMinutes
	oldHealthInterval := p.config.HealthCheckInterval
	p.config = cfg
	p.mu.Unlock()

	log.Printf("[IP-ROTATION] Config updated: strategy=%s maxFailures=%d cooldown=%dm healthInterval=%ds",
		cfg.Strategy, cfg.MaxFailures, cfg.CooldownMinutes, cfg.HealthCheckInterval)

	// Restart cooldown checker if cooldown setting changed
	if cfg.CooldownMinutes != oldCooldown {
		p.StopCooldownChecker()
		if cfg.CooldownMinutes > 0 {
			p.StartCooldownChecker()
		}
	}

	// Restart health checker if interval changed
	if cfg.HealthCheckInterval != oldHealthInterval {
		p.StopHealthChecker()
		if cfg.HealthCheckInterval > 0 {
			p.StartHealthChecker()
		}
	}

	// Auto-save if persistence is configured
	p.autoSave()

	return nil
}

// GetProxyURL은 프록시 주소(Address)에 인증 정보가 있으면 포함하여 url.URL을 반환합니다.
func (p *ProxyIP) GetProxyURL() (*url.URL, error) {
	proxyAddr := p.Address
	if p.Username != "" && p.Password != "" {
		// Parse and add auth
		u, err := url.Parse(proxyAddr)
		if err != nil {
			return nil, err
		}
		u.User = url.UserPassword(p.Username, p.Password)
		return u, nil
	}
	return url.Parse(proxyAddr)
}

// ========== Persistence Functions ==========

// SaveToFile은 현재 풀 상태를 JSON 파일로 저장합니다.
func (p *IPPool) SaveToFile(path string) error {
	p.mu.RLock()
	state := IPPoolState{
		Proxies: p.proxies,
		Order:   p.order,
		Index:   p.index,
		Config:  p.config,
		SavedAt: time.Now(),
	}
	p.mu.RUnlock()

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal pool state: %w", err)
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	log.Printf("[IP-ROTATION] Pool state saved to: %s", path)
	return nil
}

// LoadFromFile은 JSON 파일에서 풀 상태를 로드하여 적용합니다.
func (p *IPPool) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("[IP-ROTATION] No existing pool state file found: %s", path)
			return nil // Not an error if file doesn't exist
		}
		return fmt.Errorf("failed to read file: %w", err)
	}

	var state IPPoolState
	if err := json.Unmarshal(data, &state); err != nil {
		return fmt.Errorf("failed to unmarshal pool state: %w", err)
	}

	p.mu.Lock()
	p.proxies = state.Proxies
	p.order = state.Order
	p.index = state.Index
	if state.Config.Strategy != "" {
		p.config = state.Config
	}
	p.mu.Unlock()

	log.Printf("[IP-ROTATION] Pool state loaded from: %s (saved at: %s, proxies: %d)",
		path, state.SavedAt.Format(time.RFC3339), len(state.Proxies))

	return nil
}

// autoSave는 PersistencePath가 설정된 경우 풀 상태를 비동기로 저장합니다.
func (p *IPPool) autoSave() {
	if p.config.PersistencePath != "" {
		go func() {
			// Release lock before saving
			if err := p.SaveToFile(p.config.PersistencePath); err != nil {
				log.Printf("[IP-ROTATION] Auto-save failed: %v", err)
			}
		}()
	}
}

// ResetStats는 모든 프록시의 통계 값을 초기화합니다.
func (p *IPPool) ResetStats() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, proxy := range p.proxies {
		proxy.UsageCount = 0
		proxy.SuccessCount = 0
		proxy.FailCount = 0
		proxy.CaptchaCount = 0
		proxy.AvgLatencyMs = 0
	}

	log.Printf("[IP-ROTATION] Statistics reset for all proxies")
}

// ResetProxyStats는 특정 프록시의 통계를 초기화하고 비활성화 상태였다면 재활성화합니다.
func (p *IPPool) ResetProxyStats(proxyID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	proxy, ok := p.proxies[proxyID]
	if !ok {
		return errors.New("proxy not found")
	}

	proxy.UsageCount = 0
	proxy.SuccessCount = 0
	proxy.FailCount = 0
	proxy.CaptchaCount = 0
	proxy.AvgLatencyMs = 0
	// Re-enable if disabled
	if !proxy.Enabled {
		proxy.Enabled = true
		proxy.DisabledAt = time.Time{}
	}

	log.Printf("[IP-ROTATION] Statistics reset for proxy: %s", proxyID)
	return nil
}

// randomID는 프록시 ID 생성을 위한 짧은 랜덤 문자열을 반환합니다.
func randomID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	result := make([]byte, 8)
	for i := range result {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		result[i] = chars[n.Int64()]
	}
	return string(result)
}

// calculateSuccessRate는 성공/실패 카운트를 기반으로 성공률(%)을 계산합니다.
func calculateSuccessRate(p *ProxyIP) float64 {
	total := p.SuccessCount + p.FailCount
	if total == 0 {
		return 100.0
	}
	return float64(p.SuccessCount) / float64(total) * 100
}
