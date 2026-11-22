-- One-click "Shorten to fit": minutes the last plan fits before the due date.
ALTER TABLE "Task" ADD COLUMN "scheduleFitMinutes" INTEGER;
