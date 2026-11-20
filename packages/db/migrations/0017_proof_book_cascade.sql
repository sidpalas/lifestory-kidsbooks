ALTER TABLE "proof" DROP CONSTRAINT "proof_book_id_book_id_fk";
--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;