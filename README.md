# Crypto Sentiment API

Institutional-Grade Cryptocurrency Market Sentiment Analysis API targeting hedge funds, proprietary trading desks, and asset managers.

## Features

- **Real-time Sentiment Analysis** - NLP-powered sentiment scoring with FinBERT for 500+ crypto assets
- **Multi-source Data Aggregation** - Twitter/X, Reddit, news outlets, on-chain data with fallback providers
- **WebSocket Streaming** - Sub-second latency real-time updates with session recovery
- **Entity Resolution** - Wallet clustering and smart money tracking
- **Tiered Access** - Anonymous, Professional, Institutional, Enterprise, and Strategic tiers
- **Production Security** - API key authentication, rate limiting, Helmet security headers

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Redis (for rate limiting and session management)

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## API Endpoints

### Health

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Basic health check |
| `GET /health/ready` | Readiness probe (checks dependencies) |
| `GET /health/live` | Liveness probe |

### Sentiment

| Endpoint | Description |
|----------|-------------|
| `GET /v1/sentiment/:asset` | Get sentiment for a single asset |
| `GET /v1/sentiment?assets=BTC,ETH` | Get sentiment for multiple assets |
| `GET /v1/historical` | Historical sentiment data |

### Metadata

| Endpoint | Description |
|----------|-------------|
| `GET /v1/metadata/version` | API and schema version info |

### WebSocket

Connect to `ws://localhost:3000/v1/stream` for real-time sentiment updates.

```javascript
const ws = new WebSocket('ws://localhost:3000/v1/stream?clientId=your-client-id');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    assets: ['BTC', 'ETH', 'SOL']
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Sentiment update:', data);
};
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `NODE_ENV` | development | Environment |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `REDIS_PASSWORD` | - | Redis password |
| `JWT_SECRET` | - | JWT signing secret (required in production) |
| `CORS_ORIGINS` | * | Allowed CORS origins |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CloudFlare    │────▶│   API Gateway   │────▶│   Load Balancer │
│   (Edge/WAF)    │     │   (Kong)        │     │   (ALB)         │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┼────────────────────────────────┐
                        │                                │                                │
                        ▼                                ▼                                ▼
                ┌───────────────┐                ┌───────────────┐                ┌───────────────┐
                │   API Pod 1   │                │   API Pod 2   │                │   API Pod N   │
                └───────┬───────┘                └───────┬───────┘                └───────┬───────┘
                        │                                │                                │
                        └────────────────────────────────┼────────────────────────────────┘
                                                         │
                        ┌────────────────────────────────┼────────────────────────────────┐
                        │                                │                                │
                        ▼                                ▼                                ▼
                ┌───────────────┐                ┌───────────────┐                ┌───────────────┐
                │     Redis     │                │     Kafka     │                │  TimescaleDB  │
                │    (Cache)    │                │   (Streaming) │                │  (Time-series)│
                └───────────────┘                └───────────────┘                └───────────────┘
```

## Tier Comparison

| Feature | Professional | Institutional | Enterprise | Strategic |
|---------|--------------|---------------|------------|-----------|
| API Requests/sec | 10 | 50 | 200 | 1,000+ |
| WebSocket Connections | 5 | 25 | 100 | 500+ |
| Monthly API Calls | 100K | 500K | 2M | Unlimited |
| Historical Lookback | 1 year | 3 years | 5 years | 5+ years |
| REST API p99 Latency | <500ms | <200ms | <100ms | <50ms |
| SLA Availability | 99.9% | 99.9% | 99.95% | 99.99% |

## Documentation

- [Service Level Agreement](docs/sla/SERVICE_LEVEL_AGREEMENT.md)
- [Failover Architecture](docs/architecture/FAILOVER_ARCHITECTURE.md)
- [Confidence Intervals Methodology](docs/methodology/CONFIDENCE_INTERVALS.md)
- [Capacity Planning](docs/operations/CAPACITY_PLANNING.md)
- [Data Source Contingency](docs/operations/DATA_SOURCE_CONTINGENCY.md)

## Project Structure

```
src/
├── config/
│   └── default.ts              # Application configuration with validation
├── database/
│   ├── migrations/             # SQL migrations (TimescaleDB optional)
│   └── migrator.ts             # Migration runner with checksum verification
├── datasources/
│   ├── news.ts                 # CryptoPanic & NewsAPI integration
│   ├── onchain.ts              # Multi-chain blockchain analytics
│   ├── reddit.ts               # Reddit API sentiment crawling
│   └── twitter.ts              # Twitter/X with fallback providers
├── middleware/
│   └── rateLimiter.ts          # Token bucket rate limiting per tier
├── nlp/
│   └── sentimentEngine.ts      # FinBERT NLP with emotion analysis
├── services/
│   ├── aggregationPipeline.ts  # Real-time sentiment aggregation
│   └── entityResolution.ts     # Wallet clustering & smart money
├── websocket/
│   └── reconnectionProtocol.ts # Session recovery & heartbeat
├── metrics.ts                  # Prometheus metrics definitions
└── index.ts                    # Application entry point
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Development server with hot reload |
| `npm start` | Production server |
| `npm test` | Run tests |
| `npm run lint` | Lint code |
| `npm run typecheck` | Type check without emitting |

## License

UNLICENSED - Proprietary

## Support

- Professional: support@sentiment-api.io (24h response)
- Institutional: priority@sentiment-api.io (4h response)
- Enterprise: Dedicated Slack + phone (1h response)
- Strategic: Dedicated team (15min response)
