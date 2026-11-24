CREATE TYPE "public"."book_status" AS ENUM('draft', 'ordered', 'making', 'changes', 'in_review', 'approved', 'refused');--> statement-breakpoint
CREATE TYPE "public"."likeness_status" AS ENUM('waiting', 'drawing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."photo_check_status" AS ENUM('checking', 'passed', 'refused');--> statement-breakpoint
CREATE TABLE "book_likeness" (
	"book_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"photo_key" text,
	"upload_id" text,
	"photo_deleted_at" timestamp with time zone,
	"check_status" "photo_check_status",
	"check" jsonb,
	"hair" jsonb,
	"sheet_key" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_likeness_book_id_slot_id_pk" PRIMARY KEY("book_id","slot_id")
);
--> statement-breakpoint
CREATE TABLE "book_order" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"placed_by" text,
	"price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_order_book_id_unique" UNIQUE("book_id")
);
--> statement-breakpoint
CREATE TABLE "book_page" (
	"book_id" text NOT NULL,
	"page_id" text NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"chosen_version" integer DEFAULT 1 NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_page_book_id_page_id_pk" PRIMARY KEY("book_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "book_page_art" (
	"book_id" text NOT NULL,
	"page_id" text NOT NULL,
	"version" integer NOT NULL,
	"figure" integer NOT NULL,
	"slot_id" text NOT NULL,
	"object_key" text NOT NULL,
	"generation_id" text,
	"iou" double precision NOT NULL,
	"rescaled" boolean NOT NULL,
	"clipped_share" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_page_art_book_id_page_id_version_figure_pk" PRIMARY KEY("book_id","page_id","version","figure")
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family_id" text,
	"book_id" text,
	"statements" jsonb NOT NULL,
	"photo_review" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "status" "book_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
-- Books made before the photo flow keep their stock figures and stay as made books, not drafts the sweep deletes.
UPDATE "book" SET "status" = 'changes';--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "photo_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "likeness_status" "likeness_status" DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "likeness_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "cover" jsonb;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "ordered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "book_likeness" ADD CONSTRAINT "book_likeness_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_likeness" ADD CONSTRAINT "book_likeness_consent_id_consent_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_order" ADD CONSTRAINT "book_order_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_order" ADD CONSTRAINT "book_order_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_page" ADD CONSTRAINT "book_page_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_page_art" ADD CONSTRAINT "book_page_art_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_family_id_organization_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_user_idx" ON "consent" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_status_idx" ON "book" USING btree ("status");