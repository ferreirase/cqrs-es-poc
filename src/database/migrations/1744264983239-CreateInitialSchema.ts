import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1744264983239 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Criar tabela de usuários
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL,
                "name" character varying NOT NULL,
                "document" character varying NOT NULL,
                "email" character varying NOT NULL,
                "createdAt" TIMESTAMP NOT NULL,
                "updatedAt" TIMESTAMP,
                CONSTRAINT "PK_users" PRIMARY KEY ("id")
            )
        `);

    // Criar tabela de contas
    await queryRunner.query(`
            CREATE TABLE "accounts" (
                "id" uuid NOT NULL,
                "owner_id" uuid NOT NULL,
                "balance" decimal(10,2) NOT NULL DEFAULT '0.00',
                "createdAt" TIMESTAMP NOT NULL,
                "updatedAt" TIMESTAMP,
                CONSTRAINT "PK_accounts" PRIMARY KEY ("id"),
                CONSTRAINT "unique_owner" UNIQUE ("owner_id"),
                CONSTRAINT "FK_accounts_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);

    // Criar tabela de transações
    await queryRunner.query(`
            CREATE TABLE "transactions" (
                "id" uuid NOT NULL,
                "amount" decimal(10,2) NOT NULL,
                "type" character varying NOT NULL,
                "description" character varying NOT NULL,
                "sourceAccountId" uuid NOT NULL,
                "createdAt" TIMESTAMP NOT NULL,
                "updatedAt" TIMESTAMP,
                "status" character varying NOT NULL,
                "destinationAccountId" uuid,
                "processedAt" TIMESTAMP,
                "error" text,
                CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),
                CONSTRAINT "FK_transactions_source_accounts" FOREIGN KEY ("sourceAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_transactions_destination_accounts" FOREIGN KEY ("destinationAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL
            )
        `);

    // Criar tabela de eventos
    await queryRunner.query(`
            CREATE TABLE "events" (
                "id" character varying NOT NULL,
                "type" character varying NOT NULL,
                "timestamp" TIMESTAMP NOT NULL,
                "data" text NOT NULL,
                "aggregateId" character varying NOT NULL,
                CONSTRAINT "PK_events" PRIMARY KEY ("id")
            )
        `);

    // Criar índices para melhorar performance nas consultas mais comuns
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_owner_id" ON "accounts" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_sourceAccountId" ON "transactions" ("sourceAccountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_destinationAccountId" ON "transactions" ("destinationAccountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_aggregateId" ON "events" ("aggregateId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_type" ON "events" ("type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remover índices
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_aggregateId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_transactions_destinationAccountId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_transactions_sourceAccountId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_owner_id"`);

    // Remover tabelas na ordem reversa (para respeitar as foreign keys)
    await queryRunner.query(`DROP TABLE IF EXISTS "events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
