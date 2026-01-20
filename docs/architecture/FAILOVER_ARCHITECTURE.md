# Failover Architecture & Disaster Recovery
## Institutional-Grade Cryptocurrency Market Sentiment Analysis API

**Document Version:** 1.0.0
**Last Updated:** 2026-01-19
**Classification:** Technical Architecture

---

## 1. Executive Summary

This document defines the failover architecture and disaster recovery procedures for the Cryptocurrency Market Sentiment Analysis API. The architecture is designed to meet institutional-grade requirements:

| Metric | Target | Commitment |
|--------|--------|------------|
| **Availability** | 99.999% | 99.99% SLA |
| **RTO (Recovery Time Objective)** | <5 minutes | <15 minutes |
| **RPO (Recovery Point Objective)** | <1 minute | <5 minutes |

---

## 2. Multi-Region Architecture

### 2.1 Region Topology

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        GLOBAL TRAFFIC MANAGEMENT                                │
│                         (Cloudflare / AWS Global Accelerator)                   │
│                                                                                  │
│    Anycast DNS → GeoDNS Routing → Health-Based Failover                         │
└────────────────────────────┬────────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   US-EAST-1     │ │   EU-WEST-1     │ │  AP-NORTHEAST-1 │
│   (Primary)     │ │   (Secondary)   │ │   (Tertiary)    │
│   Virginia      │ │   Ireland       │ │   Tokyo         │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ • Full Stack    │ │ • Full Stack    │ │ • Full Stack    │
│ • Active        │ │ • Active        │ │ • Active        │
│ • Read/Write    │ │ • Read/Write    │ │ • Read/Write    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │   GLOBAL DATA REPLICATION   │
              │   (CockroachDB / Spanner)   │
              └─────────────────────────────┘
```

### 2.2 Region Roles

| Region | Role | Traffic Share | Failover Priority |
|--------|------|---------------|-------------------|
| **US-EAST-1** | Primary | 40% | 1 (highest) |
| **EU-WEST-1** | Secondary | 35% | 2 |
| **AP-NORTHEAST-1** | Tertiary | 25% | 3 |

### 2.3 Active-Active Architecture

All three regions operate in **active-active** mode:
- Each region can independently serve 100% of global traffic
- Requests routed by geographic proximity (latency-based)
- Data synchronously replicated across regions
- No single point of failure

---

## 3. Component-Level Redundancy

### 3.1 API Gateway Layer

```yaml
api_gateway:
  provider: Kong Enterprise
  deployment:
    us_east_1:
      instances: 6
      availability_zones: [us-east-1a, us-east-1b, us-east-1c]
    eu_west_1:
      instances: 6
      availability_zones: [eu-west-1a, eu-west-1b, eu-west-1c]
    ap_northeast_1:
      instances: 4
      availability_zones: [ap-northeast-1a, ap-northeast-1c, ap-northeast-1d]

  health_check:
    path: /health
    interval: 5s
    timeout: 3s
    unhealthy_threshold: 2
    healthy_threshold: 2

  failover:
    detection_time: <10s
    automatic: true
    manual_override: available
```

### 3.2 Application Layer (Kubernetes)

```yaml
kubernetes_clusters:
  per_region:
    control_plane: Managed (EKS/GKE)
    worker_nodes:
      min: 12
      max: 50
      scaling: horizontal_pod_autoscaler

  pod_distribution:
    api_service:
      replicas: 6
      pod_disruption_budget:
        min_available: 4
    websocket_gateway:
      replicas: 4
      pod_disruption_budget:
        min_available: 3
    sentiment_engine:
      replicas: 8
      pod_disruption_budget:
        min_available: 6

  anti_affinity:
    type: pod_anti_affinity
    topology_key: topology.kubernetes.io/zone
    # Ensures pods spread across availability zones
```

### 3.3 Data Layer

#### Primary Database (Time-Series)

```yaml
timescaledb:
  architecture: multi_node_distributed
  replication:
    type: synchronous
    regions: [us-east-1, eu-west-1, ap-northeast-1]
    write_consistency: strong

  per_region:
    access_nodes: 2
    data_nodes: 4
    storage: io2 (64,000 IOPS)

  backup:
    continuous: true (WAL streaming)
    snapshots:
      frequency: hourly
      retention: 30 days
    cross_region: enabled

  failover:
    automatic: true
    detection: <30s
    promotion_time: <60s
```

#### Cache Layer (Redis)

```yaml
redis_cluster:
  per_region:
    nodes: 6 (3 primary, 3 replica)
    memory: 64GB per node
    persistence: AOF (appendfsync everysec)

  replication:
    intra_region: synchronous
    cross_region: asynchronous (CRDT conflict resolution)
    lag_threshold: <100ms

  failover:
    sentinel_enabled: true
    automatic_failover: <10s
    quorum: 2
```

#### Message Queue (Kafka)

```yaml
kafka_cluster:
  per_region:
    brokers: 6
    replication_factor: 3
    min_insync_replicas: 2

  cross_region:
    mirroring: MirrorMaker 2.0
    topics_replicated:
      - sentiment-computed
      - alerts-triggered
      - audit-log

  retention:
    sentiment_data: 7 days
    audit_logs: 90 days

  failover:
    unclean_leader_election: false
    automatic_rebalance: true
```

---

## 4. Failover Procedures

### 4.1 Automatic Failover Matrix

| Component | Detection Time | Failover Time | Total RTO | Human Intervention |
|-----------|----------------|---------------|-----------|-------------------|
| API Gateway | 10s | 5s | **15s** | None |
| Application Pod | 30s | 10s | **40s** | None |
| Database Primary | 30s | 60s | **90s** | Optional review |
| Redis Primary | 10s | 5s | **15s** | None |
| Kafka Broker | 30s | 30s | **60s** | None |
| Full Region | 30s | 120s | **150s** | Notification only |

### 4.2 Failover Decision Tree

```
┌─────────────────────────────────────────────────────────────────┐
│                     HEALTH CHECK FAILURE                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │  Single Component?   │
                 └──────────┬───────────┘
                    Yes     │     No
                 ┌──────────┴──────────┐
                 ▼                     ▼
        ┌────────────────┐    ┌────────────────┐
        │ Replace/Restart│    │ Multiple Fails │
        │   Component    │    │  Same Region?  │
        └────────────────┘    └───────┬────────┘
                                Yes   │   No
                              ┌───────┴───────┐
                              ▼               ▼
                     ┌────────────────┐  ┌────────────────┐
                     │ Drain Region   │  │ Component-Level │
                     │ Traffic (30s)  │  │   Failover     │
                     └───────┬────────┘  └────────────────┘
                             │
                             ▼
                     ┌────────────────┐
                     │ Redistribute   │
                     │ to Other       │
                     │ Regions        │
                     └───────┬────────┘
                             │
                             ▼
                     ┌────────────────┐
                     │ Alert On-Call  │
                     │ (P2 Incident)  │
                     └────────────────┘
```

### 4.3 Regional Failover Procedure

**Trigger Conditions:**
- >50% API gateway health checks failing
- Database primary unreachable for >30s
- Network partition detected

**Automatic Steps:**

```
T+0s:    Health check failures detected
T+5s:    Secondary checks confirm failure (avoid flapping)
T+10s:   Traffic drain initiated for affected region
T+15s:   New connections routed to healthy regions
T+30s:   Existing connections gracefully terminated
T+45s:   Region marked OFFLINE in global load balancer
T+60s:   On-call engineer notified (P2 incident)
T+120s:  Full traffic redistribution complete

Total RTO: 2 minutes (within 5-minute target)
```

**Manual Steps (Post-Automatic):**

1. Investigate root cause
2. Verify data consistency across regions
3. Plan restoration of failed region
4. Execute restoration during maintenance window
5. Gradually restore traffic (10% → 25% → 50% → 100%)

---

## 5. Disaster Recovery Scenarios

### 5.1 Scenario Matrix

| Scenario | Probability | Impact | RTO | RPO | Procedure |
|----------|-------------|--------|-----|-----|-----------|
| Single pod failure | High | Minimal | <1 min | 0 | Auto-restart |
| Single node failure | Medium | Low | <5 min | 0 | Auto-replacement |
| AZ failure | Low | Medium | <5 min | <1 min | Zone failover |
| Region failure | Very Low | High | <15 min | <5 min | Region failover |
| Multi-region failure | Extremely Low | Critical | <1 hour | <15 min | DR activation |
| Data corruption | Very Low | Critical | <4 hours | Varies | Point-in-time recovery |

### 5.2 Single Region Failure

```yaml
scenario: region_failure
trigger: Complete loss of us-east-1
impact: 40% traffic affected

automatic_response:
  t_0s: Health checks fail across region
  t_10s: Global load balancer detects failure
  t_15s: Traffic routed to eu-west-1 and ap-northeast-1
  t_30s: Connection draining complete
  t_60s: All traffic served by remaining regions

capacity_impact:
  eu_west_1: 40% → 60% (+50% increase)
  ap_northeast_1: 25% → 40% (+60% increase)
  total_capacity: Sufficient (regions sized for 150% normal load)

recovery:
  estimated_time: 2-4 hours
  procedure: Regional restoration playbook
  validation: Full integration test suite
```

### 5.3 Multi-Region Failure (Catastrophic)

```yaml
scenario: multi_region_failure
trigger: Simultaneous loss of 2+ regions
probability: <0.001% annually

response:
  1_activate_dr_site:
    location: AWS GovCloud or Azure (cold standby)
    activation_time: <30 minutes
    capacity: 50% normal traffic

  2_notify_stakeholders:
    - Executive team (immediate)
    - Enterprise customers (within 15 minutes)
    - All customers (within 1 hour)

  3_status_communication:
    - Status page updated
    - Email notification
    - In-app banner

  4_reduced_operation:
    - Core endpoints only
    - Historical queries limited
    - WebSocket connections limited

recovery:
  estimated_time: 4-24 hours
  post_incident_review: mandatory
```

### 5.4 Data Corruption Recovery

```yaml
scenario: data_corruption
examples:
  - Bad deployment corrupts sentiment calculations
  - Database schema migration failure
  - External data source poisoning

detection:
  - Automated data quality monitors
  - Customer-reported anomalies
  - Cross-region consistency checks

response:
  1_identify_scope:
    - Affected time range
    - Affected assets
    - Root cause

  2_halt_propagation:
    - Stop affected pipelines
    - Prevent replication of corrupt data

  3_point_in_time_recovery:
    database:
      method: PITR from WAL
      granularity: 1 minute
      max_lookback: 7 days

    verification:
      - Checksum validation
      - Sample data inspection
      - Consistency checks

  4_data_replay:
    - Re-ingest from source (if available)
    - Recalculate derived data
    - Validate outputs

rpo_guarantee: <5 minutes for database, <1 hour for derived data
```

---

## 6. Health Monitoring

### 6.1 Health Check Endpoints

```yaml
health_endpoints:
  /health:
    purpose: Load balancer health check
    response_time: <10ms
    checks: [process_alive]

  /health/ready:
    purpose: Kubernetes readiness probe
    response_time: <50ms
    checks: [database_connection, cache_connection, dependencies]

  /health/live:
    purpose: Kubernetes liveness probe
    response_time: <10ms
    checks: [process_alive, memory_ok, no_deadlock]

  /health/deep:
    purpose: Comprehensive health (internal)
    response_time: <500ms
    checks: [all_components, data_freshness, queue_lag]
```

### 6.2 Health Check Response Format

```json
{
  "status": "healthy",
  "timestamp": "2026-01-19T14:30:00.000Z",
  "region": "us-east-1",
  "version": "2.1.0",
  "components": {
    "api": {"status": "healthy", "latency_ms": 5},
    "database": {"status": "healthy", "latency_ms": 12, "replication_lag_ms": 45},
    "cache": {"status": "healthy", "latency_ms": 2, "hit_rate": 0.94},
    "kafka": {"status": "healthy", "lag_messages": 150},
    "sentiment_engine": {"status": "healthy", "queue_depth": 23}
  },
  "data_freshness": {
    "social_sentiment": {"age_ms": 450, "threshold_ms": 1000, "status": "ok"},
    "news_sentiment": {"age_ms": 1200, "threshold_ms": 5000, "status": "ok"},
    "onchain_data": {"age_ms": 8500, "threshold_ms": 15000, "status": "ok"}
  }
}
```

### 6.3 Monitoring Stack

```yaml
monitoring:
  metrics:
    provider: Prometheus + Grafana
    retention: 90 days
    resolution: 10s

  logging:
    provider: Elasticsearch (OpenSearch)
    retention: 30 days
    structured: true (JSON)

  tracing:
    provider: Jaeger
    sampling: 1% (production), 100% (errors)
    retention: 7 days

  alerting:
    provider: PagerDuty
    escalation_policy:
      p1: immediate (on-call → lead → director)
      p2: 15 minutes (on-call → lead)
      p3: 1 hour (on-call)

  synthetic_monitoring:
    provider: Datadog Synthetics
    locations: [us, eu, asia, australia]
    frequency: 1 minute
    tests:
      - API availability
      - WebSocket connection
      - End-to-end latency
      - Data freshness
```

---

## 7. Backup Strategy

### 7.1 Backup Schedule

| Data Type | Method | Frequency | Retention | Cross-Region |
|-----------|--------|-----------|-----------|--------------|
| Database (full) | Snapshot | Daily | 30 days | Yes (3 regions) |
| Database (incremental) | WAL streaming | Continuous | 7 days | Yes |
| Configuration | Git + S3 | On change | Forever | Yes |
| Secrets | Vault snapshot | Hourly | 90 days | Yes |
| Audit logs | S3 archive | Real-time | 7 years | Yes |

### 7.2 Backup Verification

```yaml
backup_verification:
  automated_restore_test:
    frequency: weekly
    environment: isolated DR test environment
    validation:
      - Schema integrity
      - Row counts
      - Sample data queries
      - Application smoke tests

  manual_restore_drill:
    frequency: quarterly
    participants: Engineering + SRE
    documentation: Updated post-drill

  metrics_tracked:
    - Backup completion time
    - Backup size
    - Restore time
    - Data integrity score
```

---

## 8. Runbooks

### 8.1 Runbook Index

| Runbook | Trigger | On-Call Action |
|---------|---------|----------------|
| RB-001 | API latency >500ms | Investigate, scale, or failover |
| RB-002 | Database replication lag >5s | Check network, promote replica if needed |
| RB-003 | Kafka consumer lag >10,000 | Scale consumers, check for stuck partitions |
| RB-004 | Region health <50% | Initiate region drain |
| RB-005 | Data freshness SLA breach | Check pipelines, notify customers |
| RB-006 | Security incident | Isolate, preserve evidence, escalate |

### 8.2 Sample Runbook: Region Drain (RB-004)

```markdown
# RB-004: Region Drain Procedure

## Trigger
- Region health score drops below 50%
- Multiple component failures in same region
- Scheduled maintenance requiring region offline

## Prerequisites
- Verify other regions are healthy (>80%)
- Confirm capacity exists for traffic redistribution
- Notify on-call lead

## Procedure

### Step 1: Initiate Drain (T+0)
```bash
./scripts/region-drain.sh --region us-east-1 --mode gradual
```

### Step 2: Verify Traffic Shift (T+30s)
```bash
./scripts/traffic-check.sh --expect-region us-east-1 --max-percentage 10
```

### Step 3: Complete Drain (T+60s)
```bash
./scripts/region-drain.sh --region us-east-1 --mode complete
```

### Step 4: Verify Zero Traffic (T+90s)
```bash
./scripts/traffic-check.sh --expect-region us-east-1 --max-percentage 0
```

### Step 5: Mark Region Offline
```bash
./scripts/region-status.sh --region us-east-1 --status offline
```

## Rollback
If drain causes issues in receiving regions:
```bash
./scripts/region-drain.sh --region us-east-1 --mode cancel
```

## Post-Procedure
- Update incident ticket
- Notify stakeholders
- Schedule restoration
```

---

## 9. Testing & Validation

### 9.1 Chaos Engineering

```yaml
chaos_testing:
  tool: Gremlin / Chaos Monkey
  schedule: Weekly (non-peak hours)

  experiments:
    pod_failure:
      frequency: weekly
      scope: random pod in each region
      validation: No customer impact

    node_failure:
      frequency: monthly
      scope: random node per region
      validation: Auto-recovery <5 minutes

    az_failure:
      frequency: quarterly
      scope: simulate full AZ outage
      validation: Traffic redistributed <2 minutes

    region_failure:
      frequency: semi-annually
      scope: full region isolation
      validation: RTO <15 minutes, RPO <5 minutes

    network_partition:
      frequency: monthly
      scope: inter-region connectivity
      validation: Split-brain prevention works
```

### 9.2 DR Drill Schedule

| Drill Type | Frequency | Participants | Duration |
|------------|-----------|--------------|----------|
| Tabletop exercise | Quarterly | Engineering leads | 2 hours |
| Component failover | Monthly | On-call engineers | 1 hour |
| Regional failover | Semi-annually | Full engineering | 4 hours |
| Full DR activation | Annually | Engineering + Exec | 8 hours |

---

## 10. Compliance & Documentation

### 10.1 Required Documentation

- [ ] Architecture diagrams (updated quarterly)
- [ ] Runbooks (reviewed monthly)
- [ ] Incident post-mortems (within 5 business days)
- [ ] DR test results (retained 2 years)
- [ ] Backup verification logs (retained 1 year)

### 10.2 Audit Requirements

| Requirement | Standard | Evidence |
|-------------|----------|----------|
| BC/DR plan exists | SOC 2 | This document |
| BC/DR tested annually | SOC 2 | DR drill reports |
| RTO/RPO defined | SOC 2 | Section 1 |
| Backup verification | SOC 2 | Automated test logs |
| Incident response plan | SOC 2 | Runbooks |

---

## Appendix A: Contact Information

### Escalation Contacts

| Role | Name | Contact | Escalation Time |
|------|------|---------|-----------------|
| On-Call Engineer | Rotation | PagerDuty | Immediate |
| On-Call Lead | Rotation | PagerDuty | +15 minutes |
| Engineering Director | [TBD] | [Phone] | +30 minutes |
| VP Engineering | [TBD] | [Phone] | +1 hour |
| CEO | [TBD] | [Phone] | P1 only |

### External Contacts

| Service | Support Contact | Account ID |
|---------|-----------------|------------|
| AWS | aws.amazon.com/support | [Account] |
| Cloudflare | [Enterprise support] | [Account] |
| PagerDuty | support@pagerduty.com | [Account] |

---

## Appendix B: Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-19 | APEX VENTURES | Initial release |

---

**Document Owner:** Site Reliability Engineering
**Review Cycle:** Quarterly
**Next Review:** 2026-04-19
