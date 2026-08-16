-- CreateIndex
CREATE INDEX "Production_createdAt_id_idx" ON "Production"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "StockMovement_supplyId_createdAt_id_idx" ON "StockMovement"("supplyId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "StockMovement_type_createdAt_id_idx" ON "StockMovement"("type", "createdAt" DESC, "id" DESC);
