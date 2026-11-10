import { redirect } from "next/navigation";

/** Reports index: one report so far. */
export default function ReportsIndex() {
  redirect("/reports/launches");
}
