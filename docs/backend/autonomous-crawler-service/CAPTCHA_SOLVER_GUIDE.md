# CAPTCHA Solver Configuration Guide

## Overview

The autonomous-crawler-service includes comprehensive CAPTCHA solving capabilities to bypass technical blocks from search portals (Google, Bing, Naver, etc.) and Cloudflare-protected sites.

## Why IP Rotation Alone Is Not Sufficient

IP rotation helps avoid rate limiting but modern search portals use multiple detection methods:
- **Browser fingerprinting** - Detecting headless browsers
- **Behavioral analysis** - Mouse movements, typing patterns
- **CAPTCHA challenges** - reCAPTCHA, hCaptcha, Turnstile
- **JavaScript challenges** - Cloudflare's JS verification

The CAPTCHA solver system addresses these issues by:
1. Using stealth patches to avoid detection
2. Simulating human behavior
3. Solving CAPTCHAs when they appear

## Available Solvers

### Free Solvers (Built-in)

| Solver | CAPTCHA Type | Reliability | Notes |
|--------|--------------|-------------|-------|
| AudioRecaptchaSolver | reCAPTCHA v2 | Medium | Uses speech recognition |
| HCaptchaChallenger | hCaptcha | Medium | Uses AI models (YOLO/ResNet) |
| CloudflareBypasser | Cloudflare JS | Low | Uses cloudscraper library |
| NopeCHA | All types | Medium | Browser extension approach |

### Paid Solvers (Recommended for Production)

| Service | Supported Types | Avg. Speed | Cost |
|---------|-----------------|------------|------|
| **CapSolver** | reCAPTCHA v2/v3, hCaptcha, Turnstile | 10-30s | ~$2/1000 |
| **2Captcha** | reCAPTCHA v2/v3, hCaptcha, Turnstile | 15-45s | ~$3/1000 |

## Configuration

### Environment Variables

Add these to your `.env` file or Docker Compose configuration:

```bash
# CapSolver (Recommended - Best for Cloudflare Turnstile)
# Get API key at: https://capsolver.com
CAPTCHA_CAPSOLVER_API_KEY=your_capsolver_api_key

# 2Captcha (Alternative - Widely used)
# Get API key at: https://2captcha.com
CAPTCHA_TWOCAPTCHA_API_KEY=your_2captcha_api_key

# Solver preferences
CAPTCHA_PREFER_PAID_SOLVER=true  # Use paid solvers first when available
CAPTCHA_PAID_SOLVER_TIMEOUT=120  # Timeout in seconds

# Enable CAPTCHA solving
CAPTCHA_ENABLED=true

# Stealth features
STEALTH_ENABLED=true
```

### Docker Compose Example

```yaml
autonomous-crawler:
  environment:
    - CAPTCHA_ENABLED=true
    - CAPTCHA_CAPSOLVER_API_KEY=${CAPTCHA_CAPSOLVER_API_KEY:-}
    - CAPTCHA_TWOCAPTCHA_API_KEY=${CAPTCHA_TWOCAPTCHA_API_KEY:-}
    - CAPTCHA_PREFER_PAID_SOLVER=true
    - CAPTCHA_PAID_SOLVER_TIMEOUT=120
```

## Solver Priority

When `CAPTCHA_PREFER_PAID_SOLVER=true` (default):

1. **CapSolver** (if API key provided)
2. **2Captcha** (if API key provided)
3. **Free solvers** (as fallback)

When `CAPTCHA_PREFER_PAID_SOLVER=false`:

1. **Free solvers** (AudioRecaptcha, HCaptcha, CloudflareBypasser)
2. **Paid solvers** (as fallback)

## IP Rotation + CAPTCHA Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Search Request Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Get Proxy from IP Rotation Service                          │
│     └─► Weighted selection (considers CAPTCHA history)          │
│                                                                 │
│  2. Apply Stealth Patches                                       │
│     └─► Fingerprint spoofing, human simulation                  │
│                                                                 │
│  3. Navigate to Search Portal                                   │
│     └─► Google, Bing, Naver, etc.                               │
│                                                                 │
│  4. CAPTCHA Detection                                           │
│     └─► Check for reCAPTCHA, hCaptcha, Turnstile                │
│                                                                 │
│  5. If CAPTCHA Detected:                                        │
│     ├─► Report to IP Rotation (penalize proxy weight)           │
│     ├─► Try Paid Solver (CapSolver/2Captcha)                    │
│     ├─► Fallback to Free Solver                                 │
│     └─► On failure: Rotate proxy and retry                      │
│                                                                 │
│  6. Extract Search Results                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### CAPTCHAs Still Appearing Frequently

1. **Check proxy quality** - Low-quality proxies trigger more CAPTCHAs
2. **Reduce request rate** - Too many requests cause blocking
3. **Use residential proxies** - Datacenter IPs are easily detected

### Paid Solver Not Working

1. **Verify API key** - Check balance on the service dashboard
2. **Check timeout** - Increase `CAPTCHA_PAID_SOLVER_TIMEOUT` for slow solving
3. **View logs** - Check for error messages in crawler logs

### Cloudflare Blocking

1. **Use CapSolver** - Best support for Cloudflare Turnstile
2. **Enable Camoufox** - Firefox-based anti-detect browser
3. **Check User-Agent** - Must match browser fingerprint

## API Reference

### CaptchaSolverOrchestrator

```python
from src.captcha import CaptchaSolverOrchestrator, CaptchaType

# Initialize with paid solvers
solver = CaptchaSolverOrchestrator(
    capsolver_api_key="your_key",
    twocaptcha_api_key="your_key",
    prefer_paid=True,
    paid_timeout=120.0,
)

# Solve a CAPTCHA
result = await solver.solve(
    captcha_type=CaptchaType.RECAPTCHA_V2,
    page=playwright_page,  # Playwright page object
)

if result.success:
    print(f"Solved by {result.solver_used} in {result.time_ms}ms")
else:
    print(f"Failed: {result.error}")
```

## Recommendations

1. **Start with CapSolver** - Best balance of speed, reliability, and cost
2. **Use both services** - Configure both for redundancy
3. **Monitor CAPTCHA rates** - High rates indicate detection issues
4. **Invest in good proxies** - Quality proxies reduce CAPTCHA frequency
5. **Enable all stealth features** - Reduce detection before CAPTCHA appears
