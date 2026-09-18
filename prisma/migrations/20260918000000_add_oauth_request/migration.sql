CREATE TABLE "OAuthRequest" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthRequest_state_key" ON "OAuthRequest"("state");

ALTER TABLE "OAuthRequest" ADD CONSTRAINT "OAuthRequest_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
