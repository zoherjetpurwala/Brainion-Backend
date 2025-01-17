/*
  Warnings:

  - The `embedding` column on the `Document` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `embedding` column on the `Note` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `embedding` column on the `Tweet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `embedding` column on the `YouTubeVideo` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "embedding",
ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "Note" DROP COLUMN "embedding",
ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "Tweet" DROP COLUMN "embedding",
ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "YouTubeVideo" DROP COLUMN "embedding",
ADD COLUMN     "embedding" vector(1536);
