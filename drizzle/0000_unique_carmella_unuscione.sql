CREATE TYPE "public"."fortune_theme" AS ENUM('general', 'health', 'wealth', 'love', 'wish', 'home', 'great');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('ornament', 'candy_cane', 'gift', 'teddy', 'sock', 'carpet', 'star');--> statement-breakpoint
CREATE TABLE "daily_offers" (
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"candidates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_offers_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "daily_picks" (
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"item_type" "item_type" NOT NULL,
	"color" text NOT NULL,
	"variant" text NOT NULL,
	"pos_x" real NOT NULL,
	"pos_y" real NOT NULL,
	"pos_z" real NOT NULL,
	"fortune_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_picks_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "fortunes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fortunes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"theme" "fortune_theme" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"advice" text NOT NULL,
	"lucky_color" text NOT NULL,
	"lucky_item" text NOT NULL,
	"lucky_number" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kakao_id" text NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_kakaoId_unique" UNIQUE("kakao_id")
);
--> statement-breakpoint
ALTER TABLE "daily_offers" ADD CONSTRAINT "daily_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_fortune_id_fortunes_id_fk" FOREIGN KEY ("fortune_id") REFERENCES "public"."fortunes"("id") ON DELETE no action ON UPDATE no action;