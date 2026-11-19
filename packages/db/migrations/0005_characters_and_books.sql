CREATE TABLE "book" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"story_version_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_cast" (
	"book_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"character_id" text NOT NULL,
	"look_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_cast_book_id_slot_id_pk" PRIMARY KEY("book_id","slot_id")
);
--> statement-breakpoint
CREATE TABLE "book_text_edit" (
	"book_id" text NOT NULL,
	"page_id" text NOT NULL,
	"block_index" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_text_edit_book_id_page_id_block_index_pk" PRIMARY KEY("book_id","page_id","block_index")
);
--> statement-breakpoint
CREATE TABLE "character" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"pronouns" text NOT NULL,
	"look" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proof" ADD COLUMN "book_id" text;--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_family_id_organization_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_cast" ADD CONSTRAINT "book_cast_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_cast" ADD CONSTRAINT "book_cast_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_text_edit" ADD CONSTRAINT "book_text_edit_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_family_id_organization_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_family_idx" ON "book" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "book_cast_character_idx" ON "book_cast" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "character_family_idx" ON "character" USING btree ("family_id");--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_book_idx" ON "proof" USING btree ("book_id");