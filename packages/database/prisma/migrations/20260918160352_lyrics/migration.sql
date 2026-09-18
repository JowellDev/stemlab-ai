-- CreateTable
CREATE TABLE "lyrics" (
    "trackId" TEXT NOT NULL,
    "language" TEXT,
    "languageConfidence" DOUBLE PRECISION NOT NULL,
    "lines" JSONB NOT NULL,
    "translations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lyrics_pkey" PRIMARY KEY ("trackId")
);

-- AddForeignKey
ALTER TABLE "lyrics" ADD CONSTRAINT "lyrics_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
