-- AlterTable
ALTER TABLE `Procedure` ADD COLUMN `defaultPrice` DECIMAL(10, 2) NULL,
    MODIFY `estimatedDurationMinutes` INTEGER NULL;
