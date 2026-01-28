// =============================================================================
// Database Migrator
// Handles schema migrations for TimescaleDB
// =============================================================================

import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { URL } from 'url';

// =============================================================================
// Types
// =============================================================================

interface Migration {
  id: number;
  name: string;
  filename: string;
  checksum: string;
  appliedAt?: Date;
}

interface MigrationResult {
  success: boolean;
  migrationsRun: string[];
  error?: string;
}

interface MigratorConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  migrationsPath: string;
  schemaTable: string;
}

// =============================================================================
// Migrator
// =============================================================================

export class DatabaseMigrator {
  private pool: Pool;
  private config: MigratorConfig;

  /**
   * Validates schema table name to prevent SQL injection.
   * Only allows valid PostgreSQL identifier characters.
   */
  private validateSchemaTable(name: string): void {
    // PostgreSQL identifiers: start with letter or underscore, contain letters, digits, underscores
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
      throw new Error(
        `Invalid schema table name: "${name}". ` +
        'Must start with letter or underscore and contain only letters, digits, and underscores.'
      );
    }
    // Additional length check (PostgreSQL max identifier is 63 chars)
    if (name.length > 63) {
      throw new Error(`Schema table name too long: ${name.length} chars (max 63)`);
    }
  }

  constructor(config: Partial<MigratorConfig> = {}) {
    const schemaTable = config.schemaTable || '_migrations';
    this.validateSchemaTable(schemaTable);

    // Parse DATABASE_URL if provided (Railway format)
    const dbUrl = process.env.DATABASE_URL;
    let dbUrlConfig: { host: string; port: number; database: string; user: string; password: string; ssl: boolean } | null = null;

    if (dbUrl) {
      try {
        const url = new URL(dbUrl);
        const sslMode = url.searchParams.get('sslmode');
        dbUrlConfig = {
          host: url.hostname,
          port: parseInt(url.port || '5432'),
          database: url.pathname.slice(1),
          user: url.username,
          password: url.password,
          ssl: sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca',
        };
      } catch (e) {
        console.error('[Migrator] Failed to parse DATABASE_URL:', e);
      }
    }

    // Determine SSL: explicit DB_SSL takes precedence, then DATABASE_URL, then production default
    const sslEnv = process.env.DB_SSL || process.env.DATABASE_SSL;
    const sslEnabled = (sslEnv && ['true', '1', 'yes', 'on'].includes(sslEnv.trim().toLowerCase())) ||
      dbUrlConfig?.ssl ||
      process.env.NODE_ENV === 'production';

    this.config = {
      host: config.host || process.env.DB_HOST || dbUrlConfig?.host || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT || '') || dbUrlConfig?.port || 5432,
      database: config.database || process.env.DB_NAME || dbUrlConfig?.database || 'sentiment',
      user: config.user || process.env.DB_USER || dbUrlConfig?.user || 'sentiment',
      password: config.password || process.env.DB_PASSWORD || dbUrlConfig?.password || '',
      migrationsPath: config.migrationsPath || path.join(__dirname, 'migrations'),
      schemaTable,
    };

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 10000,
    });
  }

  // ===========================================================================
  // Main Migration Methods
  // ===========================================================================

  async migrate(): Promise<MigrationResult> {
    const client = await this.pool.connect();
    const migrationsRun: string[] = [];

    try {
      // Ensure migrations table exists
      await this.ensureMigrationsTable(client);

      // Get pending migrations
      const pending = await this.getPendingMigrations(client);

      if (pending.length === 0) {
        console.log('[Migrator] No pending migrations');
        return { success: true, migrationsRun: [] };
      }

      console.log(`[Migrator] Found ${pending.length} pending migration(s)`);

      // Run each migration in a transaction
      for (const migration of pending) {
        console.log(`[Migrator] Running migration: ${migration.name}`);

        await client.query('BEGIN');

        try {
          // Read and execute migration
          const sql = fs.readFileSync(
            path.join(this.config.migrationsPath, migration.filename),
            'utf8'
          );

          await client.query(sql);

          // Record migration
          await client.query(
            `INSERT INTO ${this.config.schemaTable} (id, name, filename, checksum, applied_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [migration.id, migration.name, migration.filename, migration.checksum]
          );

          await client.query('COMMIT');
          migrationsRun.push(migration.name);
          console.log(`[Migrator] Completed: ${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration ${migration.name} failed: ${error instanceof Error ? error.message : error}`
          );
        }
      }

      console.log(`[Migrator] Successfully ran ${migrationsRun.length} migration(s)`);
      return { success: true, migrationsRun };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Migrator] Migration failed: ${message}`);
      return { success: false, migrationsRun, error: message };
    } finally {
      client.release();
    }
  }

  async rollback(steps: number = 1): Promise<MigrationResult> {
    const client = await this.pool.connect();
    const migrationsRolledBack: string[] = [];

    try {
      // Get applied migrations (most recent first)
      const result = await client.query<Migration>(
        `SELECT id, name, filename, checksum, applied_at
         FROM ${this.config.schemaTable}
         ORDER BY id DESC
         LIMIT $1`,
        [steps]
      );

      if (result.rows.length === 0) {
        console.log('[Migrator] No migrations to rollback');
        return { success: true, migrationsRun: [] };
      }

      for (const migration of result.rows) {
        console.log(`[Migrator] Rolling back: ${migration.name}`);

        // Look for down migration file
        const downFilename = migration.filename.replace('.sql', '.down.sql');
        const downPath = path.join(this.config.migrationsPath, downFilename);

        await client.query('BEGIN');

        try {
          if (fs.existsSync(downPath)) {
            const sql = fs.readFileSync(downPath, 'utf8');
            await client.query(sql);
          } else {
            console.warn(`[Migrator] No down migration found for ${migration.name}`);
          }

          // Remove migration record
          await client.query(
            `DELETE FROM ${this.config.schemaTable} WHERE id = $1`,
            [migration.id]
          );

          await client.query('COMMIT');
          migrationsRolledBack.push(migration.name);
          console.log(`[Migrator] Rolled back: ${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(
            `Rollback of ${migration.name} failed: ${error instanceof Error ? error.message : error}`
          );
        }
      }

      return { success: true, migrationsRun: migrationsRolledBack };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Migrator] Rollback failed: ${message}`);
      return { success: false, migrationsRun: migrationsRolledBack, error: message };
    } finally {
      client.release();
    }
  }

  async status(): Promise<{ applied: Migration[]; pending: Migration[] }> {
    const client = await this.pool.connect();

    try {
      await this.ensureMigrationsTable(client);

      const appliedResult = await client.query<Migration>(
        `SELECT id, name, filename, checksum, applied_at
         FROM ${this.config.schemaTable}
         ORDER BY id ASC`
      );

      const pending = await this.getPendingMigrations(client);

      return {
        applied: appliedResult.rows,
        pending,
      };
    } finally {
      client.release();
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async ensureMigrationsTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.schemaTable} (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async getPendingMigrations(client: PoolClient): Promise<Migration[]> {
    // Get all migration files
    const files = fs
      .readdirSync(this.config.migrationsPath)
      .filter(f => f.match(/^\d+_.+\.sql$/) && !f.includes('.down.'))
      .sort();

    // Get applied migrations
    const result = await client.query<{ id: number; checksum: string }>(
      `SELECT id, checksum FROM ${this.config.schemaTable}`
    );

    const appliedMap = new Map(result.rows.map(r => [r.id, r.checksum]));

    // Find pending migrations
    const pending: Migration[] = [];

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) continue;

      const id = parseInt(match[1]);
      const name = match[2].replace(/_/g, ' ');
      const filePath = path.join(this.config.migrationsPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const checksum = crypto.createHash('sha256').update(content).digest('hex');

      const appliedChecksum = appliedMap.get(id);

      if (!appliedChecksum) {
        pending.push({ id, name, filename: file, checksum });
      } else if (appliedChecksum !== checksum) {
        throw new Error(
          `Migration ${file} has been modified after being applied. ` +
          `Expected checksum: ${appliedChecksum}, got: ${checksum}`
        );
      }
    }

    return pending;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const command = process.argv[2];
  const migrator = new DatabaseMigrator();

  try {
    switch (command) {
      case 'migrate':
      case 'up': {
        const result = await migrator.migrate();
        if (!result.success) {
          process.exit(1);
        }
        break;
      }

      case 'rollback':
      case 'down': {
        const steps = parseInt(process.argv[3] || '1');
        const result = await migrator.rollback(steps);
        if (!result.success) {
          process.exit(1);
        }
        break;
      }

      case 'status': {
        const status = await migrator.status();
        console.log('\n=== Applied Migrations ===');
        if (status.applied.length === 0) {
          console.log('  (none)');
        } else {
          for (const m of status.applied) {
            console.log(`  [${m.id}] ${m.name} (${m.appliedAt?.toISOString()})`);
          }
        }
        console.log('\n=== Pending Migrations ===');
        if (status.pending.length === 0) {
          console.log('  (none)');
        } else {
          for (const m of status.pending) {
            console.log(`  [${m.id}] ${m.name}`);
          }
        }
        break;
      }

      case 'create': {
        const name = process.argv[3];
        if (!name) {
          console.error('Usage: migrator create <migration_name>');
          process.exit(1);
        }

        const migrationsPath = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsPath)) {
          fs.mkdirSync(migrationsPath, { recursive: true });
        }

        // Get next migration number
        const files = fs.readdirSync(migrationsPath).filter(f => f.match(/^\d+/));
        const maxId = files.reduce((max, f) => {
          const match = f.match(/^(\d+)/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);

        const nextId = String(maxId + 1).padStart(4, '0');
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const filename = `${nextId}_${safeName}.sql`;
        const downFilename = `${nextId}_${safeName}.down.sql`;

        fs.writeFileSync(
          path.join(migrationsPath, filename),
          `-- Migration: ${name}\n-- Created: ${new Date().toISOString()}\n\n-- Add your migration SQL here\n`
        );

        fs.writeFileSync(
          path.join(migrationsPath, downFilename),
          `-- Rollback: ${name}\n-- Created: ${new Date().toISOString()}\n\n-- Add your rollback SQL here\n`
        );

        console.log(`Created migration files:`);
        console.log(`  ${filename}`);
        console.log(`  ${downFilename}`);
        break;
      }

      default:
        console.log('Usage: migrator <command>');
        console.log('');
        console.log('Commands:');
        console.log('  migrate, up    Run pending migrations');
        console.log('  rollback, down Rollback the last migration (or specify count)');
        console.log('  status         Show migration status');
        console.log('  create <name>  Create a new migration');
    }
  } finally {
    await migrator.close();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
