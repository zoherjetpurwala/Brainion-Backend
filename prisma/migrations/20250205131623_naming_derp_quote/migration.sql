/*
  Warnings:

  - You are about to drop the `Qoute` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Qoute";

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
