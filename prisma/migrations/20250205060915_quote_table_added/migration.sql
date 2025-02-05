-- CreateTable
CREATE TABLE "Qoute" (
    "id" TEXT NOT NULL,
    "qoute" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Qoute_pkey" PRIMARY KEY ("id")
);
