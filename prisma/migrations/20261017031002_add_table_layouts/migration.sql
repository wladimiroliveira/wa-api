-- CreateTable
CREATE TABLE "table_layouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "table_key" TEXT NOT NULL,
    "order" TEXT[],
    "widths" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "table_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_table_layouts_user_id_table_key" ON "table_layouts"("user_id", "table_key");

-- AddForeignKey
ALTER TABLE "table_layouts" ADD CONSTRAINT "table_layouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
