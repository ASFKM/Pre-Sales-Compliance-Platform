-- Full editable proposal text - lets the user review/rewrite the generated proposal content
-- before submitting for approval, instead of only being able to export the auto-generated file.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "editable_content" TEXT;
