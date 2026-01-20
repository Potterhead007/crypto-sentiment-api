/**
 * Real-Time Status Page System
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Real-time system status monitoring
 * - Component health tracking
 * - Incident management
 * - Scheduled maintenance notifications
 * - Historical uptime reporting
 */

import { EventEmitter } from 'events';
import { Router, Request, Response } from 'express';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type ComponentStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage' | 'maintenance';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'critical' | 'major' | 'minor' | 'maintenance';

export interface StatusComponent {
  id: string;
  name: string;
  description: string;
  group: string;
  status: ComponentStatus;
  updatedAt: Date;
  metrics?: ComponentMetrics;
}

export interface ComponentMetrics {
  uptime_24h: number;
  uptime_7d: number;
  uptime_30d: number;
  response_time_ms: number;
  error_rate: number;
}

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  affectedComponents: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  updates: IncidentUpdate[];
  metadata: Record<string, any>;
}

export interface IncidentUpdate {
  id: string;
  status: IncidentStatus;
  message: string;
  createdAt: Date;
  createdBy: string;
}

export interface ScheduledMaintenance {
  id: string;
  title: string;
  description: string;
  affectedComponents: string[];
  scheduledStart: Date;
  scheduledEnd: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
  updates: MaintenanceUpdate[];
}

export interface MaintenanceUpdate {
  id: string;
  message: string;
  createdAt: Date;
}

export interface SystemStatus {
  status: ComponentStatus;
  updatedAt: Date;
  components: StatusComponent[];
  activeIncidents: Incident[];
  scheduledMaintenances: ScheduledMaintenance[];
  metrics: SystemMetrics;
}

export interface SystemMetrics {
  uptime_90d: number;
  incidents_30d: number;
  mttr_hours: number;
  availability_sla: number;
}

export interface UptimeDay {
  date: string;
  uptime: number;
  incidents: number;
  status: 'operational' | 'incident' | 'maintenance';
}

// =============================================================================
// STATUS PAGE MANAGER
// =============================================================================

export class StatusPageManager extends EventEmitter {
  private components: Map<string, StatusComponent> = new Map();
  private incidents: Map<string, Incident> = new Map();
  private maintenances: Map<string, ScheduledMaintenance> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.initializeComponents();
  }

  private initializeComponents(): void {
    const defaultComponents: Omit<StatusComponent, 'status' | 'updatedAt' | 'metrics'>[] = [
      // API
      { id: 'api_rest', name: 'REST API', description: 'Core REST API endpoints', group: 'API' },
      { id: 'api_websocket', name: 'WebSocket API', description: 'Real-time streaming endpoints', group: 'API' },
      { id: 'api_historical', name: 'Historical API', description: 'Historical data queries', group: 'API' },

      // Data Pipeline
      { id: 'pipeline_social', name: 'Social Data Pipeline', description: 'Twitter, Reddit, Telegram ingestion', group: 'Data Pipeline' },
      { id: 'pipeline_news', name: 'News Pipeline', description: 'News and media ingestion', group: 'Data Pipeline' },
      { id: 'pipeline_onchain', name: 'On-Chain Pipeline', description: 'Blockchain data ingestion', group: 'Data Pipeline' },
      { id: 'pipeline_exchange', name: 'Exchange Pipeline', description: 'Exchange data ingestion', group: 'Data Pipeline' },

      // Processing
      { id: 'processing_sentiment', name: 'Sentiment Engine', description: 'NLP sentiment analysis', group: 'Processing' },
      { id: 'processing_aggregation', name: 'Aggregation Engine', description: 'Cross-source aggregation', group: 'Processing' },

      // Infrastructure
      { id: 'infra_database', name: 'Database', description: 'Primary database cluster', group: 'Infrastructure' },
      { id: 'infra_cache', name: 'Cache', description: 'Redis cache cluster', group: 'Infrastructure' },
      { id: 'infra_queue', name: 'Message Queue', description: 'Kafka message queue', group: 'Infrastructure' },

      // Regions
      { id: 'region_us_east', name: 'US East', description: 'US East (Virginia) region', group: 'Regions' },
      { id: 'region_eu_west', name: 'EU West', description: 'EU West (Ireland) region', group: 'Regions' },
      { id: 'region_ap_north', name: 'Asia Pacific', description: 'Asia Pacific (Tokyo) region', group: 'Regions' },
    ];

    for (const comp of defaultComponents) {
      this.components.set(comp.id, {
        ...comp,
        status: 'operational',
        updatedAt: new Date(),
        metrics: {
          uptime_24h: 100,
          uptime_7d: 99.99,
          uptime_30d: 99.98,
          response_time_ms: 45,
          error_rate: 0.01,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // COMPONENT MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Update component status
   */
  updateComponentStatus(
    componentId: string,
    status: ComponentStatus,
    metrics?: Partial<ComponentMetrics>
  ): StatusComponent {
    const component = this.components.get(componentId);
    if (!component) {
      throw new Error(`Component ${componentId} not found`);
    }

    const previousStatus = component.status;
    component.status = status;
    component.updatedAt = new Date();

    if (metrics) {
      component.metrics = { ...component.metrics!, ...metrics };
    }

    // Emit event if status changed
    if (previousStatus !== status) {
      this.emit('component_status_changed', {
        componentId,
        previousStatus,
        newStatus: status,
        timestamp: component.updatedAt,
      });
    }

    return component;
  }

  /**
   * Get component by ID
   */
  getComponent(componentId: string): StatusComponent | null {
    return this.components.get(componentId) || null;
  }

  /**
   * Get all components
   */
  getAllComponents(): StatusComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Get components by group
   */
  getComponentsByGroup(): Record<string, StatusComponent[]> {
    const groups: Record<string, StatusComponent[]> = {};

    for (const component of this.components.values()) {
      if (!groups[component.group]) {
        groups[component.group] = [];
      }
      groups[component.group].push(component);
    }

    return groups;
  }

  // ---------------------------------------------------------------------------
  // INCIDENT MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Create a new incident
   */
  createIncident(
    title: string,
    severity: IncidentSeverity,
    affectedComponents: string[],
    message: string,
    createdBy: string = 'system'
  ): Incident {
    const id = `inc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const incident: Incident = {
      id,
      title,
      status: 'investigating',
      severity,
      affectedComponents,
      createdAt: now,
      updatedAt: now,
      updates: [
        {
          id: `upd_${Date.now()}`,
          status: 'investigating',
          message,
          createdAt: now,
          createdBy,
        },
      ],
      metadata: {},
    };

    this.incidents.set(id, incident);

    // Update affected component statuses
    const componentStatus = this.severityToComponentStatus(severity);
    for (const compId of affectedComponents) {
      this.updateComponentStatus(compId, componentStatus);
    }

    this.emit('incident_created', incident);
    return incident;
  }

  /**
   * Update an incident
   */
  updateIncident(
    incidentId: string,
    status: IncidentStatus,
    message: string,
    createdBy: string = 'system'
  ): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const now = new Date();

    incident.status = status;
    incident.updatedAt = now;
    incident.updates.push({
      id: `upd_${Date.now()}`,
      status,
      message,
      createdAt: now,
      createdBy,
    });

    if (status === 'resolved') {
      incident.resolvedAt = now;

      // Restore component statuses
      for (const compId of incident.affectedComponents) {
        this.updateComponentStatus(compId, 'operational');
      }
    }

    this.emit('incident_updated', incident);
    return incident;
  }

  /**
   * Get active incidents
   */
  getActiveIncidents(): Incident[] {
    return Array.from(this.incidents.values())
      .filter(i => i.status !== 'resolved')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get recent incidents
   */
  getRecentIncidents(days: number = 7): Incident[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return Array.from(this.incidents.values())
      .filter(i => i.createdAt >= cutoff)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ---------------------------------------------------------------------------
  // MAINTENANCE MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Schedule maintenance
   */
  scheduleMaintenance(
    title: string,
    description: string,
    affectedComponents: string[],
    scheduledStart: Date,
    scheduledEnd: Date
  ): ScheduledMaintenance {
    const id = `maint_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const maintenance: ScheduledMaintenance = {
      id,
      title,
      description,
      affectedComponents,
      scheduledStart,
      scheduledEnd,
      status: 'scheduled',
      createdAt: now,
      updates: [],
    };

    this.maintenances.set(id, maintenance);
    this.emit('maintenance_scheduled', maintenance);
    return maintenance;
  }

  /**
   * Start maintenance
   */
  startMaintenance(maintenanceId: string, message?: string): ScheduledMaintenance {
    const maintenance = this.maintenances.get(maintenanceId);
    if (!maintenance) {
      throw new Error(`Maintenance ${maintenanceId} not found`);
    }

    maintenance.status = 'in_progress';

    if (message) {
      maintenance.updates.push({
        id: `upd_${Date.now()}`,
        message,
        createdAt: new Date(),
      });
    }

    // Update component statuses
    for (const compId of maintenance.affectedComponents) {
      this.updateComponentStatus(compId, 'maintenance');
    }

    this.emit('maintenance_started', maintenance);
    return maintenance;
  }

  /**
   * Complete maintenance
   */
  completeMaintenance(maintenanceId: string, message?: string): ScheduledMaintenance {
    const maintenance = this.maintenances.get(maintenanceId);
    if (!maintenance) {
      throw new Error(`Maintenance ${maintenanceId} not found`);
    }

    maintenance.status = 'completed';

    if (message) {
      maintenance.updates.push({
        id: `upd_${Date.now()}`,
        message,
        createdAt: new Date(),
      });
    }

    // Restore component statuses
    for (const compId of maintenance.affectedComponents) {
      this.updateComponentStatus(compId, 'operational');
    }

    this.emit('maintenance_completed', maintenance);
    return maintenance;
  }

  /**
   * Get scheduled maintenances
   */
  getScheduledMaintenances(): ScheduledMaintenance[] {
    return Array.from(this.maintenances.values())
      .filter(m => m.status === 'scheduled' || m.status === 'in_progress')
      .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
  }

  // ---------------------------------------------------------------------------
  // SYSTEM STATUS
  // ---------------------------------------------------------------------------

  /**
   * Get overall system status
   */
  getSystemStatus(): SystemStatus {
    const components = this.getAllComponents();
    const activeIncidents = this.getActiveIncidents();
    const scheduledMaintenances = this.getScheduledMaintenances();

    // Determine overall status
    let status: ComponentStatus = 'operational';

    // Check for any non-operational components
    const statuses = components.map(c => c.status);

    if (statuses.some(s => s === 'major_outage')) {
      status = 'major_outage';
    } else if (statuses.some(s => s === 'partial_outage')) {
      status = 'partial_outage';
    } else if (statuses.some(s => s === 'degraded_performance')) {
      status = 'degraded_performance';
    } else if (statuses.some(s => s === 'maintenance')) {
      status = 'maintenance';
    }

    // Calculate system metrics
    const metrics = this.calculateSystemMetrics();

    return {
      status,
      updatedAt: new Date(),
      components,
      activeIncidents,
      scheduledMaintenances,
      metrics,
    };
  }

  /**
   * Calculate system metrics
   */
  private calculateSystemMetrics(): SystemMetrics {
    const components = this.getAllComponents();
    const recentIncidents = this.getRecentIncidents(30);

    // Calculate average uptime across components
    const uptime90d = components.reduce(
      (sum, c) => sum + (c.metrics?.uptime_30d || 99),
      0
    ) / components.length;

    // Calculate MTTR from resolved incidents
    const resolvedIncidents = Array.from(this.incidents.values())
      .filter(i => i.resolvedAt);

    const mttrHours = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((sum, i) => {
          const duration = (i.resolvedAt!.getTime() - i.createdAt.getTime()) / (1000 * 60 * 60);
          return sum + duration;
        }, 0) / resolvedIncidents.length
      : 0;

    return {
      uptime_90d: Math.round(uptime90d * 100) / 100,
      incidents_30d: recentIncidents.length,
      mttr_hours: Math.round(mttrHours * 10) / 10,
      availability_sla: 99.99,
    };
  }

  /**
   * Get uptime history
   */
  getUptimeHistory(days: number = 90): UptimeDay[] {
    const history: UptimeDay[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Check for incidents on this day
      const dayIncidents = Array.from(this.incidents.values()).filter(inc => {
        const incDate = inc.createdAt.toISOString().split('T')[0];
        return incDate === dateStr;
      });

      // Check for maintenance on this day
      const dayMaintenance = Array.from(this.maintenances.values()).filter(m => {
        const startDate = m.scheduledStart.toISOString().split('T')[0];
        return startDate === dateStr;
      });

      let status: UptimeDay['status'] = 'operational';
      let uptime = 100;

      if (dayIncidents.length > 0) {
        status = 'incident';
        // Estimate downtime based on incident severity
        const downtimeMinutes = dayIncidents.reduce((sum, inc) => {
          switch (inc.severity) {
            case 'critical': return sum + 60;
            case 'major': return sum + 30;
            case 'minor': return sum + 10;
            default: return sum;
          }
        }, 0);
        uptime = Math.max(0, 100 - (downtimeMinutes / 1440) * 100);
      } else if (dayMaintenance.length > 0) {
        status = 'maintenance';
        uptime = 99.5; // Maintenance doesn't count against SLA
      }

      history.push({
        date: dateStr,
        uptime: Math.round(uptime * 100) / 100,
        incidents: dayIncidents.length,
        status,
      });
    }

    return history;
  }

  // ---------------------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------------------

  private severityToComponentStatus(severity: IncidentSeverity): ComponentStatus {
    switch (severity) {
      case 'critical': return 'major_outage';
      case 'major': return 'partial_outage';
      case 'minor': return 'degraded_performance';
      case 'maintenance': return 'maintenance';
    }
  }

  /**
   * Start health check loop
   */
  startHealthChecks(intervalMs: number = 30000): void {
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, intervalMs);
  }

  /**
   * Stop health check loop
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async runHealthChecks(): Promise<void> {
    // This would actually ping services in production
    // For now, emit an event that can be handled by actual health checkers
    this.emit('health_check_requested');
  }
}

// =============================================================================
// STATUS PAGE ROUTES
// =============================================================================

export function createStatusPageRoutes(manager: StatusPageManager): Router {
  const router = Router();

  // Get overall system status
  router.get('/status', (_req: Request, res: Response) => {
    const status = manager.getSystemStatus();
    res.json(status);
  });

  // Get status summary (minimal response)
  router.get('/status/summary', (_req: Request, res: Response) => {
    const status = manager.getSystemStatus();
    res.json({
      status: status.status,
      updated_at: status.updatedAt,
      active_incidents: status.activeIncidents.length,
      scheduled_maintenances: status.scheduledMaintenances.length,
    });
  });

  // Get all components
  router.get('/status/components', (_req: Request, res: Response) => {
    const grouped = manager.getComponentsByGroup();
    res.json({
      groups: Object.entries(grouped).map(([group, components]) => ({
        name: group,
        components: components.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          status: c.status,
          updated_at: c.updatedAt,
        })),
      })),
    });
  });

  // Get specific component
  router.get('/status/components/:componentId', (req: Request, res: Response) => {
    const component = manager.getComponent(req.params.componentId);

    if (!component) {
      res.status(404).json({
        error: {
          code: 'COMPONENT_NOT_FOUND',
          message: `Component ${req.params.componentId} not found`,
        },
      });
      return;
    }

    res.json(component);
  });

  // Get active incidents
  router.get('/status/incidents', (req: Request, res: Response) => {
    const active = req.query.active === 'true';
    const days = parseInt(req.query.days as string) || 7;

    const incidents = active
      ? manager.getActiveIncidents()
      : manager.getRecentIncidents(days);

    res.json({
      incidents: incidents.map(i => ({
        id: i.id,
        title: i.title,
        status: i.status,
        severity: i.severity,
        affected_components: i.affectedComponents,
        created_at: i.createdAt,
        updated_at: i.updatedAt,
        resolved_at: i.resolvedAt,
        updates: i.updates.map(u => ({
          status: u.status,
          message: u.message,
          created_at: u.createdAt,
        })),
      })),
    });
  });

  // Get specific incident
  router.get('/status/incidents/:incidentId', (req: Request, res: Response) => {
    const incidents = manager.getRecentIncidents(90);
    const incident = incidents.find(i => i.id === req.params.incidentId);

    if (!incident) {
      res.status(404).json({
        error: {
          code: 'INCIDENT_NOT_FOUND',
          message: `Incident ${req.params.incidentId} not found`,
        },
      });
      return;
    }

    res.json(incident);
  });

  // Get scheduled maintenances
  router.get('/status/maintenances', (_req: Request, res: Response) => {
    const maintenances = manager.getScheduledMaintenances();
    res.json({
      maintenances: maintenances.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        affected_components: m.affectedComponents,
        scheduled_start: m.scheduledStart,
        scheduled_end: m.scheduledEnd,
        status: m.status,
      })),
    });
  });

  // Get uptime history
  router.get('/status/uptime', (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string) || 90;
    const history = manager.getUptimeHistory(days);

    // Calculate summary
    const totalUptime = history.reduce((sum, d) => sum + d.uptime, 0) / history.length;
    const totalIncidents = history.reduce((sum, d) => sum + d.incidents, 0);

    res.json({
      period_days: days,
      average_uptime: Math.round(totalUptime * 100) / 100,
      total_incidents: totalIncidents,
      daily: history,
    });
  });

  // Subscribe to status updates (SSE)
  router.get('/status/subscribe', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial status
    const status = manager.getSystemStatus();
    res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);

    // Listen for updates
    const onStatusChange = (data: any) => {
      res.write(`data: ${JSON.stringify({ type: 'component_update', data })}\n\n`);
    };

    const onIncident = (data: any) => {
      res.write(`data: ${JSON.stringify({ type: 'incident', data })}\n\n`);
    };

    manager.on('component_status_changed', onStatusChange);
    manager.on('incident_created', onIncident);
    manager.on('incident_updated', onIncident);

    // Cleanup on close
    req.on('close', () => {
      manager.off('component_status_changed', onStatusChange);
      manager.off('incident_created', onIncident);
      manager.off('incident_updated', onIncident);
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  StatusPageManager,
  createStatusPageRoutes,
};
