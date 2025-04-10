import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterTransactionTable1744268727220 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verificar se a coluna "accountId" existe
    const checkColumnQuery = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' 
            AND column_name = 'accountId'
        `);

    if (checkColumnQuery.length > 0) {
      // 1. Renomear accountId para sourceAccountId
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                RENAME COLUMN "accountId" TO "sourceAccountId"
            `);

      // 2. Renomear targetAccountId para destinationAccountId
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                RENAME COLUMN "targetAccountId" TO "destinationAccountId"
            `);

      // 3. Renomear constraints e índices
      // Remover FK existentes
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP CONSTRAINT IF EXISTS "FK_transactions_accounts"
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP CONSTRAINT IF EXISTS "FK_transactions_target_accounts"
            `);

      // Adicionar novas FK
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD CONSTRAINT "FK_transactions_source_accounts" 
                FOREIGN KEY ("sourceAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD CONSTRAINT "FK_transactions_destination_accounts" 
                FOREIGN KEY ("destinationAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL
            `);

      // Atualizar índices
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_transactions_accountId"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_transactions_targetAccountId"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_transactions_sourceAccountId" ON "transactions" ("sourceAccountId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_transactions_destinationAccountId" ON "transactions" ("destinationAccountId")`,
      );

      // 4. Adicionar os campos faltantes
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD COLUMN IF NOT EXISTS "error" TEXT
            `);

      // 5. Remover coluna "notificationSent" se existir
      const checkNotificationSentQuery = await queryRunner.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'transactions' 
                AND column_name = 'notificationSent'
            `);
      if (checkNotificationSentQuery.length > 0) {
        await queryRunner.query(`
                    ALTER TABLE "transactions" 
                    DROP COLUMN "notificationSent"
                `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Verificar se a coluna "sourceAccountId" existe
    const checkColumnQuery = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' 
            AND column_name = 'sourceAccountId'
        `);

    if (checkColumnQuery.length > 0) {
      // 1. Reverter: Renomear sourceAccountId para accountId
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                RENAME COLUMN "sourceAccountId" TO "accountId"
            `);

      // 2. Reverter: Renomear destinationAccountId para targetAccountId
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                RENAME COLUMN "destinationAccountId" TO "targetAccountId"
            `);

      // 3. Reverter constraints e índices
      // Remover FK existentes
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP CONSTRAINT IF EXISTS "FK_transactions_source_accounts"
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP CONSTRAINT IF EXISTS "FK_transactions_destination_accounts"
            `);

      // Adicionar antigas FK
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD CONSTRAINT "FK_transactions_accounts" 
                FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD CONSTRAINT "FK_transactions_target_accounts" 
                FOREIGN KEY ("targetAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL
            `);

      // Atualizar índices
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_transactions_sourceAccountId"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_transactions_destinationAccountId"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_transactions_accountId" ON "transactions" ("accountId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_transactions_targetAccountId" ON "transactions" ("targetAccountId")`,
      );

      // 4. Remover campos adicionados
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP COLUMN IF EXISTS "processedAt"
            `);
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                DROP COLUMN IF EXISTS "error"
            `);

      // 5. Adicionar de volta coluna "notificationSent"
      await queryRunner.query(`
                ALTER TABLE "transactions" 
                ADD COLUMN "notificationSent" character varying
            `);
    }
  }
}
