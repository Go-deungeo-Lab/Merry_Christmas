ALTER TABLE "daily_picks" ALTER COLUMN "item_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."item_type";--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('ornament', 'light', 'gift', 'teddy', 'carpet', 'snow', 'star');--> statement-breakpoint
ALTER TABLE "daily_picks" ALTER COLUMN "item_type" SET DATA TYPE "public"."item_type" USING "item_type"::"public"."item_type";--> statement-breakpoint
ALTER TABLE "fortunes" DROP COLUMN "theme";--> statement-breakpoint
DROP TYPE "public"."fortune_theme";