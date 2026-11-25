CREATE TABLE "book_pose_photo" (
	"book_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"pose" text NOT NULL,
	"photo_key" text,
	"upload_id" text NOT NULL,
	"photo_deleted_at" timestamp with time zone,
	"check_status" "photo_check_status" DEFAULT 'checking' NOT NULL,
	"check" jsonb,
	"consent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_pose_photo_book_id_slot_id_pose_pk" PRIMARY KEY("book_id","slot_id","pose")
);
--> statement-breakpoint
ALTER TABLE "book_pose_photo" ADD CONSTRAINT "book_pose_photo_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_pose_photo" ADD CONSTRAINT "book_pose_photo_consent_id_consent_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consent"("id") ON DELETE set null ON UPDATE no action;