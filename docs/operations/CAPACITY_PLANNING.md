# Capacity Planning Guide
## Institutional-Grade Cryptocurrency Market Sentiment Analysis API

**Document Version:** 1.0.0
**Last Updated:** 2026-01-19
**Classification:** Operations Documentation

---

## 1. Executive Summary

This document defines capacity allocations, throughput limits, and scaling guidelines for each pricing tier. Use this guide to:
- Understand resource allocation per tier
- Plan for capacity upgrades
- Monitor utilization thresholds
- Request custom capacity arrangements

---

## 2. Tier Capacity Overview

### 2.1 Quick Reference Matrix

| Metric | Professional | Institutional | Enterprise | Strategic |
|--------|--------------|---------------|------------|-----------|
| **API Requests/sec** | 10 | 50 | 200 | 1,000+ |
| **Burst Capacity** | 50 (10s) | 200 (10s) | 1,000 (10s) | 5,000+ |
| **WebSocket Connections** | 5 | 25 | 100 | 500+ |
| **WS Messages/sec** | 50 | 250 | 1,000 | 5,000+ |
| **Monthly API Calls** | 100,000 | 500,000 | 2,000,000 | Unlimited |
| **Historical Lookback** | 1 year | 3 years | 5 years | 5+ years |
| **Concurrent Queries** | 2 | 10 | 50 | 200+ |
| **Bulk Export (rows/req)** | 1,000 | 10,000 | 100,000 | 1,000,000 |

### 2.2 Latency Guarantees

| Endpoint Type | Professional | Institutional | Enterprise | Strategic |
|---------------|--------------|---------------|------------|-----------|
| REST API (p50) | <200ms | <100ms | <50ms | <25ms |
| REST API (p99) | <500ms | <200ms | <100ms | <50ms |
| WebSocket (p50) | <100ms | <50ms | <25ms | <10ms |
| WebSocket (p99) | <200ms | <100ms | <50ms | <25ms |
| Historical Query | <2s | <1s | <500ms | <200ms |
| Bulk Export | <30s | <15s | <10s | <5s |

---

## 3. Detailed Tier Specifications

### 3.1 Professional Tier

**Target Use Cases:**
- Boutique trading firms
- Research analysts
- Crypto-native startups
- Individual quantitative traders

**Capacity Allocation:**

```yaml
professional_tier:
  rate_limiting:
    requests_per_second: 10
    burst_capacity: 50
    burst_window_seconds: 10
    monthly_quota: 100,000

  websocket:
    max_connections: 5
    messages_per_second: 50
    subscriptions_per_connection: 20
    max_assets_subscribed: 50

  historical:
    lookback_days: 365
    max_data_points_per_query: 10,000
    concurrent_queries: 2
    query_timeout_seconds: 30

  export:
    max_rows_per_request: 1,000
    max_exports_per_day: 10
    supported_formats: [json, csv]

  compute:
    request_timeout_ms: 30,000
    max_request_body_kb: 100
    max_response_body_mb: 10
```

**Infrastructure Allocation:**
- Shared API gateway pool
- Shared compute cluster (standard priority)
- Standard cache allocation
- Multi-tenant database access

---

### 3.2 Institutional Tier

**Target Use Cases:**
- Mid-size hedge funds ($50M-$500M AUM)
- Family offices with crypto allocation
- Regional asset managers
- Crypto-focused research firms

**Capacity Allocation:**

```yaml
institutional_tier:
  rate_limiting:
    requests_per_second: 50
    burst_capacity: 200
    burst_window_seconds: 10
    monthly_quota: 500,000

  websocket:
    max_connections: 25
    messages_per_second: 250
    subscriptions_per_connection: 50
    max_assets_subscribed: 200

  historical:
    lookback_days: 1095  # 3 years
    max_data_points_per_query: 100,000
    concurrent_queries: 10
    query_timeout_seconds: 60

  export:
    max_rows_per_request: 10,000
    max_exports_per_day: 50
    supported_formats: [json, csv, parquet]

  compute:
    request_timeout_ms: 60,000
    max_request_body_kb: 500
    max_response_body_mb: 50

  premium_features:
    priority_support: true
    custom_alerts: 50
    api_key_limit: 10
```

**Infrastructure Allocation:**
- Dedicated API gateway capacity (10% of regional pool)
- Priority compute queue
- Enhanced cache allocation (2x Professional)
- Dedicated read replicas for historical queries

---

### 3.3 Enterprise Tier

**Target Use Cases:**
- Large hedge funds ($500M+ AUM)
- Proprietary trading desks
- Tier-1 asset managers
- Prime brokers

**Capacity Allocation:**

```yaml
enterprise_tier:
  rate_limiting:
    requests_per_second: 200
    burst_capacity: 1,000
    burst_window_seconds: 10
    monthly_quota: 2,000,000

  websocket:
    max_connections: 100
    messages_per_second: 1,000
    subscriptions_per_connection: 100
    max_assets_subscribed: 500
    dedicated_ws_pool: true

  historical:
    lookback_days: 1825  # 5 years
    max_data_points_per_query: 1,000,000
    concurrent_queries: 50
    query_timeout_seconds: 120
    dedicated_query_pool: true

  export:
    max_rows_per_request: 100,000
    max_exports_per_day: unlimited
    supported_formats: [json, csv, parquet, arrow]
    streaming_export: true

  compute:
    request_timeout_ms: 120,000
    max_request_body_kb: 2,000
    max_response_body_mb: 200
    dedicated_compute: true

  premium_features:
    priority_support: true
    custom_alerts: unlimited
    api_key_limit: 50
    dedicated_csm: true
    custom_sla: available
    sso_integration: true
```

**Infrastructure Allocation:**
- Dedicated API gateway instances
- Reserved compute capacity
- Dedicated cache namespace
- Primary database access with connection pooling
- Optional: dedicated regional deployment

---

### 3.4 Strategic Tier

**Target Use Cases:**
- Global investment banks
- Sovereign wealth funds
- Crypto exchanges
- Market makers
- Prime brokers with multiple desks

**Capacity Allocation:**

```yaml
strategic_tier:
  rate_limiting:
    requests_per_second: 1,000+  # Custom negotiated
    burst_capacity: 5,000+
    burst_window_seconds: 10
    monthly_quota: unlimited

  websocket:
    max_connections: 500+
    messages_per_second: 5,000+
    subscriptions_per_connection: unlimited
    max_assets_subscribed: all
    dedicated_ws_cluster: true

  historical:
    lookback_days: unlimited
    max_data_points_per_query: unlimited
    concurrent_queries: 200+
    query_timeout_seconds: 300
    dedicated_analytics_cluster: true

  export:
    max_rows_per_request: 1,000,000+
    max_exports_per_day: unlimited
    supported_formats: all
    streaming_export: true
    direct_s3_delivery: available

  compute:
    request_timeout_ms: 300,000
    max_request_body_kb: 10,000
    max_response_body_mb: 1,000
    dedicated_compute_cluster: true

  premium_features:
    everything_in_enterprise: true
    custom_models: available
    raw_data_access: available
    white_label: available
    on_premise_option: available
    colocation: available
```

**Infrastructure Allocation:**
- Fully dedicated infrastructure stack
- Custom regional deployment options
- Direct peering available
- Colocation in major financial data centers
- Custom SLA and support arrangements

---

## 4. Resource Utilization Guidelines

### 4.1 Monitoring Thresholds

| Metric | Green | Yellow | Red | Action |
|--------|-------|--------|-----|--------|
| Request Rate (% of limit) | <70% | 70-85% | >85% | Consider upgrade |
| WS Connections (% of limit) | <80% | 80-90% | >90% | Add connections or upgrade |
| Monthly Quota (% used) | <70% | 70-90% | >90% | Upgrade before month end |
| P99 Latency (vs SLA) | <50% | 50-80% | >80% | Review query patterns |
| Error Rate | <0.1% | 0.1-1% | >1% | Contact support |

### 4.2 Rate Limit Response Behavior

When rate limits are exceeded:

```
Request Rate Exceeded:
├── HTTP 429 returned
├── Retry-After header included
├── X-RateLimit-* headers present
└── Request queued for 0-10s before rejection (Enterprise+)

Burst Capacity Exceeded:
├── Immediate 429 for requests beyond burst
├── Burst replenishes at requests_per_second rate
└── Full burst available after burst_window_seconds

Monthly Quota Exceeded:
├── HTTP 429 returned
├── Quota resets at month start (UTC)
├── Overage billing available (Enterprise+)
└── Emergency quota increase available (contact support)
```

---

## 5. Scaling Guidelines

### 5.1 Vertical Scaling (Tier Upgrade)

**When to Upgrade:**

| From | To | Trigger Indicators |
|------|----|--------------------|
| Professional | Institutional | >80% rate limit consistently, need 3yr history |
| Institutional | Enterprise | >50 WS connections needed, latency-sensitive |
| Enterprise | Strategic | Multi-desk deployment, custom requirements |

**Upgrade Process:**
1. Contact account manager or sales
2. Receive capacity assessment
3. Review new tier agreement
4. Schedule migration window (typically instant)
5. Update API keys (optional, existing keys can be upgraded)

### 5.2 Horizontal Scaling (Within Tier)

**Additional Capacity Options:**

| Add-On | Professional | Institutional | Enterprise |
|--------|--------------|---------------|------------|
| +10 WS connections | $200/mo | $150/mo | $100/mo |
| +100K API calls/mo | $100/mo | $75/mo | $50/mo |
| +1 year historical | $500/yr | $400/yr | $300/yr |
| Additional API key | $50/mo | $25/mo | Included |

### 5.3 Burst Handling

For predictable high-volume events (e.g., market opens, announcements):

```yaml
burst_planning:
  advance_notice: 24 hours minimum
  request_method: Email to support with:
    - Expected peak rate
    - Duration
    - Affected endpoints

  automatic_burst:
    professional: 5x for 60 seconds
    institutional: 4x for 120 seconds
    enterprise: 5x for 300 seconds
    strategic: custom

  pre_arranged_burst:
    available_for: Enterprise, Strategic
    lead_time: 24 hours
    max_multiplier: 10x
    duration: up to 1 hour
```

---

## 6. Infrastructure Architecture

### 6.1 Request Flow

```
Client Request
     │
     ▼
┌─────────────────┐
│   CloudFlare    │ ◄── DDoS Protection, WAF
│   (Edge)        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   API Gateway   │ ◄── Rate Limiting, Auth, Routing
│   (Kong)        │     Tier-based capacity pools
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Load Balancer │ ◄── Least-connections routing
│   (ALB)         │     Health-based failover
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ API   │ │ API   │ ◄── Kubernetes pods
│ Pod 1 │ │ Pod N │     HPA based on load
└───┬───┘ └───┬───┘
    │         │
    └────┬────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ Redis │ │ Kafka │ ◄── Cache & Message Queue
└───────┘ └───────┘
         │
         ▼
┌─────────────────┐
│   TimescaleDB   │ ◄── Time-series storage
│   (Primary)     │     Multi-region replicas
└─────────────────┘
```

### 6.2 Capacity by Region

| Region | API Capacity | WS Capacity | DB Replicas |
|--------|--------------|-------------|-------------|
| US-EAST-1 | 100K req/s | 50K conn | 3 |
| EU-WEST-1 | 75K req/s | 40K conn | 3 |
| AP-NORTHEAST-1 | 50K req/s | 25K conn | 2 |
| **Total** | **225K req/s** | **115K conn** | **8** |

---

## 7. Capacity Planning Formulas

### 7.1 Estimating Required Capacity

**API Requests:**
```
Required RPS = (Active Assets × Updates/min × Safety Factor) / 60

Example (Institutional):
- 100 assets monitored
- 1 update per minute per asset
- 2x safety factor
Required RPS = (100 × 1 × 2) / 60 = 3.3 RPS
Allocated: 50 RPS ✓ Sufficient
```

**WebSocket Connections:**
```
Required Connections = Desks × Strategies × Connection Buffer

Example (Enterprise):
- 5 trading desks
- 4 strategies per desk
- 2x buffer for failover
Required = 5 × 4 × 2 = 40 connections
Allocated: 100 connections ✓ Sufficient
```

**Monthly Quota:**
```
Required Quota = (RPS × Active Hours × Trading Days × Safety Factor)

Example (Institutional):
- 5 RPS average
- 12 active hours/day
- 22 trading days/month
- 1.5x safety factor
Required = 5 × 3600 × 12 × 22 × 1.5 = 7,128,000
Allocated: 500,000 ✗ Upgrade needed
```

### 7.2 Cost-Efficiency Analysis

| Metric | Professional | Institutional | Enterprise |
|--------|--------------|---------------|------------|
| Price/month | $1,500 | $4,500 | $12,000 |
| API calls included | 100,000 | 500,000 | 2,000,000 |
| Cost per 1K calls | $15.00 | $9.00 | $6.00 |
| WS connections | 5 | 25 | 100 |
| Cost per connection | $300 | $180 | $120 |

**Break-even Analysis:**
- Institutional makes sense at >166K calls/month
- Enterprise makes sense at >833K calls/month

---

## 8. Capacity Management APIs

### 8.1 Check Current Usage

```bash
GET /v1/account/usage

Response:
{
  "tier": "institutional",
  "period": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-31T23:59:59Z"
  },
  "api_calls": {
    "used": 234567,
    "limit": 500000,
    "percentage": 46.9
  },
  "rate_limit": {
    "current_rps": 12.5,
    "limit_rps": 50,
    "percentage": 25.0
  },
  "websocket": {
    "active_connections": 18,
    "limit": 25,
    "percentage": 72.0
  },
  "recommendations": [
    {
      "type": "warning",
      "message": "WebSocket usage at 72%. Consider upgrading if trend continues."
    }
  ]
}
```

### 8.2 Request Capacity Increase

```bash
POST /v1/account/capacity/request

{
  "type": "burst",
  "reason": "FOMC announcement coverage",
  "requested_capacity": {
    "rps": 200,
    "duration_minutes": 60
  },
  "scheduled_time": "2026-01-29T19:00:00Z"
}

Response:
{
  "request_id": "cap_req_abc123",
  "status": "approved",
  "approved_capacity": {
    "rps": 150,
    "duration_minutes": 60
  },
  "activation_time": "2026-01-29T18:55:00Z",
  "notes": "Approved at 75% of requested capacity"
}
```

---

## 9. Support Escalation

### 9.1 Capacity-Related Issues

| Issue | First Response | Escalation Path |
|-------|----------------|-----------------|
| Hitting rate limits | Self-service dashboard | Support ticket |
| Need temporary burst | Email support | Account manager |
| Upgrade request | Sales contact | Account manager |
| Custom capacity | Account manager | Solutions architect |
| Emergency capacity | Support hotline | On-call engineer |

### 9.2 Contact Information

| Tier | Support Channel | Response Time |
|------|-----------------|---------------|
| Professional | support@sentiment-api.io | 24 hours |
| Institutional | priority@sentiment-api.io | 4 hours |
| Enterprise | Dedicated Slack + phone | 1 hour |
| Strategic | Dedicated team | 15 minutes |

---

## Appendix A: Capacity Planning Checklist

**Before Going Live:**
- [ ] Calculate expected RPS based on use case
- [ ] Determine WebSocket connection requirements
- [ ] Estimate monthly API call volume
- [ ] Identify burst scenarios (market events, rebalancing)
- [ ] Select appropriate tier
- [ ] Configure alerting for usage thresholds
- [ ] Test failover behavior
- [ ] Document escalation procedures

**Monthly Review:**
- [ ] Review usage dashboard
- [ ] Check for rate limit events
- [ ] Analyze latency percentiles
- [ ] Evaluate tier appropriateness
- [ ] Plan for upcoming capacity needs

---

## Appendix B: Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-19 | Initial release |

---

**Document Owner:** Solutions Architecture
**Review Cycle:** Quarterly
**Next Review:** 2026-04-19
