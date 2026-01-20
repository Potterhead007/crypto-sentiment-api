# Service Level Agreement (SLA)
## Institutional-Grade Cryptocurrency Market Sentiment Analysis API

**Document Version:** 1.0.0
**Effective Date:** [CONTRACT_START_DATE]
**Last Updated:** 2026-01-19

---

## 1. Overview

This Service Level Agreement ("SLA") describes the service level commitments for the Cryptocurrency Market Sentiment Analysis API ("Service") provided to Customer ("you" or "your"). This SLA is incorporated into and forms part of the Master Service Agreement between the parties.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| **Availability** | The percentage of time the Service is operational and accessible |
| **Downtime** | Period when the Service is unavailable, excluding Scheduled Maintenance |
| **Error Rate** | Percentage of API requests returning 5xx errors |
| **Latency** | Time from request receipt to response delivery |
| **Monthly Uptime Percentage** | (Total Minutes - Downtime Minutes) / Total Minutes × 100 |
| **P99 Latency** | 99th percentile response time |
| **Scheduled Maintenance** | Pre-announced maintenance windows |

---

## 3. Service Level Objectives

### 3.1 Availability Targets

| Tier | Design Target | Contractual SLA | Max Annual Downtime |
|------|---------------|-----------------|---------------------|
| Professional | 99.95% | **99.9%** | 8.76 hours |
| Institutional | 99.99% | **99.95%** | 4.38 hours |
| Enterprise | 99.999% | **99.99%** | 52.6 minutes |
| Strategic | 99.999% | **Custom** | Negotiated |

**Measurement Period:** Rolling 30-day calendar window

**Calculation:**
```
Monthly Uptime % = ((Total Minutes - Downtime Minutes) / Total Minutes) × 100
```

### 3.2 Latency Commitments

#### REST API Endpoints

| Tier | Target (p50) | Commitment (p99) | Burst Tolerance |
|------|--------------|------------------|-----------------|
| Professional | <100ms | **<500ms** | 1s allowed |
| Institutional | <50ms | **<200ms** | 500ms allowed |
| Enterprise | <25ms | **<100ms** | 200ms allowed |

#### WebSocket Streaming

| Tier | Target (p50) | Commitment (p99) | Jitter Max |
|------|--------------|------------------|------------|
| Professional | <50ms | **<200ms** | 100ms |
| Institutional | <25ms | **<100ms** | 50ms |
| Enterprise | <10ms | **<50ms** | 25ms |

### 3.3 Data Freshness Commitments

| Data Type | Target | Commitment | Notes |
|-----------|--------|------------|-------|
| Aggregated Sentiment | <500ms | **<1s** | From computation complete |
| Social Ingestion | <5s | **<15s** | Platform-dependent |
| News Sentiment | <2s | **<5s** | From publication |
| On-Chain Data | Block+2s | **Block+10s** | Chain-dependent |
| Microstructure | <100ms | **<500ms** | Exchange-dependent |

### 3.4 Error Rate Commitments

| Metric | Target | Commitment |
|--------|--------|------------|
| 5xx Error Rate | <0.01% | **<0.1%** |
| 4xx Error Rate (platform) | <0.1% | **<0.5%** |
| Data Quality Errors | <0.001% | **<0.01%** |

---

## 4. Scheduled Maintenance

### 4.1 Maintenance Windows

| Type | Frequency | Duration | Notice Period |
|------|-----------|----------|---------------|
| Standard | Weekly | Max 30 min | 72 hours |
| Extended | Monthly | Max 4 hours | 7 days |
| Emergency | As needed | As required | Best effort |

### 4.2 Maintenance Schedule

- **Standard Window:** Sundays 02:00-06:00 UTC
- **Extended Window:** First Sunday of month, 02:00-06:00 UTC
- **Notification:** Via email, status page, and API header warnings

### 4.3 Maintenance Exclusions

Scheduled maintenance does not count toward Downtime if:
1. Notice was provided per the schedule above
2. Maintenance occurred within announced window
3. Total monthly maintenance did not exceed 4 hours

---

## 5. Service Credits

### 5.1 Credit Schedule

| Monthly Uptime | Service Credit |
|----------------|----------------|
| 99.99% - 99.95% | 10% of monthly fee |
| 99.95% - 99.9% | 25% of monthly fee |
| 99.9% - 99.0% | 50% of monthly fee |
| Below 99.0% | 100% of monthly fee |

### 5.2 Credit Request Process

1. **Submission:** Within 30 days of incident via support ticket
2. **Required Information:**
   - Account ID
   - Affected time period (UTC)
   - Description of impact
   - Request ID(s) affected (if applicable)
3. **Review:** Within 10 business days
4. **Credit Application:** Applied to next billing cycle

### 5.3 Credit Limitations

- Maximum credit: 100% of monthly fee for affected service
- Credits are non-transferable and non-refundable
- Credits do not apply to:
  - Force majeure events
  - Customer-caused issues
  - Beta or preview features
  - Free tier usage

---

## 6. Exclusions

The following are excluded from SLA calculations:

### 6.1 Customer-Side Issues
- Customer network connectivity
- Customer firewall or security configurations
- Customer code or integration issues
- Exceeding rate limits or quota

### 6.2 External Factors
- Internet backbone issues beyond our network edge
- DNS issues outside our infrastructure
- Third-party service provider outages (with documented mitigation)
- Force majeure events

### 6.3 Platform Limitations
- Features explicitly marked as "Beta" or "Preview"
- Sandbox/testing environments
- Deprecated API versions past end-of-life date
- Usage exceeding documented limits

---

## 7. Support Response Times

### 7.1 Priority Definitions

| Priority | Definition | Examples |
|----------|------------|----------|
| **P1 - Critical** | Complete service outage affecting production | API returning 5xx for all requests |
| **P2 - High** | Major functionality degraded | WebSocket disconnections, data delays >5x SLA |
| **P3 - Medium** | Minor functionality issues | Single endpoint slow, cosmetic issues |
| **P4 - Low** | Questions, feature requests | Documentation questions, enhancement requests |

### 7.2 Response Time Commitments

| Priority | Professional | Institutional | Enterprise |
|----------|--------------|---------------|------------|
| P1 | 4 hours | 1 hour | **15 minutes** |
| P2 | 24 hours | 4 hours | **1 hour** |
| P3 | 72 hours | 24 hours | **4 hours** |
| P4 | Best effort | 72 hours | **24 hours** |

### 7.3 Resolution Targets

| Priority | Target Resolution | Update Frequency |
|----------|-------------------|------------------|
| P1 | 4 hours | Every 30 minutes |
| P2 | 8 hours | Every 2 hours |
| P3 | 48 hours | Daily |
| P4 | Best effort | As available |

---

## 8. Monitoring & Reporting

### 8.1 Status Page

**URL:** https://status.sentiment-api.io

Provides real-time information on:
- Current system status
- Active incidents
- Scheduled maintenance
- Historical uptime (90 days)

### 8.2 API Health Headers

Every response includes:
```http
X-Service-Status: operational
X-Response-Time-Ms: 45
X-RateLimit-Remaining: 9500
X-Data-Freshness-Ms: 487
```

### 8.3 Monthly Reports (Enterprise+)

Enterprise and Strategic tier customers receive monthly reports including:
- Availability metrics
- Latency percentiles
- Error rate analysis
- Data quality metrics
- Incident summaries

---

## 9. Incident Management

### 9.1 Incident Classification

| Level | Name | Criteria | Response |
|-------|------|----------|----------|
| SEV-1 | Critical | >50% users affected, complete outage | All hands, exec notification |
| SEV-2 | Major | >10% users affected, significant degradation | Engineering escalation |
| SEV-3 | Minor | <10% users affected, limited impact | Standard response |
| SEV-4 | Low | Cosmetic, non-functional | Normal queue |

### 9.2 Communication Protocol

| Severity | Initial Update | Status Page | Email | Phone |
|----------|----------------|-------------|-------|-------|
| SEV-1 | <15 min | Immediate | Immediate | Enterprise only |
| SEV-2 | <30 min | Immediate | <1 hour | On request |
| SEV-3 | <2 hours | If prolonged | Daily digest | No |
| SEV-4 | <24 hours | No | No | No |

### 9.3 Post-Incident Review

For SEV-1 and SEV-2 incidents:
- **Timeline:** Published within 5 business days
- **Contents:** Root cause, impact, timeline, remediation
- **Delivery:** Email to affected Enterprise customers
- **Meeting:** Available upon request for Enterprise tier

---

## 10. Data Retention & Recovery

### 10.1 Backup Schedule

| Data Type | Frequency | Retention | Recovery Point |
|-----------|-----------|-----------|----------------|
| Configuration | Continuous | 90 days | <1 minute |
| Sentiment Data | Hourly | 7 years | <1 hour |
| Audit Logs | Real-time | 7 years | <5 minutes |
| Customer Data | Daily | 30 days | <24 hours |

### 10.2 Recovery Objectives

| Metric | Target | Commitment |
|--------|--------|------------|
| Recovery Time Objective (RTO) | <5 min | **<15 min** |
| Recovery Point Objective (RPO) | <1 min | **<5 min** |

---

## 11. Geographic Performance

### 11.1 Regional Latency Expectations

| Client Region | To US-EAST | To EU-WEST | To AP-NORTH |
|---------------|------------|------------|-------------|
| US East | <10ms | ~80ms | ~150ms |
| US West | ~50ms | ~130ms | ~100ms |
| Europe | ~80ms | <10ms | ~200ms |
| Asia Pacific | ~150ms | ~200ms | <10ms |

### 11.2 Regional Routing

- Requests automatically routed to nearest healthy region
- Manual region selection available via `X-Preferred-Region` header
- Enterprise tier: Dedicated regional deployment available

---

## 12. SLA Amendments

### 12.1 Modification Process

- 30-day notice for SLA improvements
- 90-day notice for any SLA degradation
- Notification via email and status page
- Enterprise customers: Direct account manager communication

### 12.2 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-19 | Initial release |

---

## 13. Contact Information

### Support Channels

| Tier | Email | Phone | Slack |
|------|-------|-------|-------|
| Professional | support@sentiment-api.io | - | - |
| Institutional | priority@sentiment-api.io | +1-XXX-XXX-XXXX | Shared channel |
| Enterprise | enterprise@sentiment-api.io | Dedicated line | Dedicated channel |

### Escalation Path

1. **Level 1:** Support Team
2. **Level 2:** Engineering Lead
3. **Level 3:** VP Engineering
4. **Level 4:** CEO (Enterprise only)

---

## Appendix A: SLA Calculation Examples

### Example 1: Availability Calculation
```
Month: 30 days = 43,200 minutes
Downtime events:
  - Incident 1: 15 minutes
  - Incident 2: 8 minutes
  - Total Downtime: 23 minutes

Uptime = (43,200 - 23) / 43,200 × 100 = 99.947%

For Institutional tier (99.95% SLA): Within SLA, no credit
For Professional tier (99.9% SLA): Within SLA, no credit
```

### Example 2: Credit Calculation
```
Monthly fee: $4,500 (Institutional)
Monthly uptime: 99.85%

SLA threshold: 99.95%
Uptime range: 99.9% - 99.95% → 10% credit

Credit amount: $4,500 × 10% = $450
```

---

**Document Control:**
- Owner: Engineering
- Approver: Legal, Finance
- Review Cycle: Quarterly

---

*This SLA is subject to the terms of your Master Service Agreement. In case of conflict, the Master Service Agreement governs.*
