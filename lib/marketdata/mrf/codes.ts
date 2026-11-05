/**
 * Benchmark basket: high-volume, comparable services (largely CMS's 70 "shoppable services") plus the
 * inpatient DRGs that drive hospital spend. Keeping the basket small is what makes TB-scale files tractable.
 */
export type BenchCode = { code: string; type: "CPT" | "MS-DRG" | "APR-DRG"; label: string; category: string };

export const BENCH_CODES: BenchCode[] = [
  // Office & emergency visits
  { code: "99203", type: "CPT", label: "New patient office visit (low)", category: "Visits" },
  { code: "99204", type: "CPT", label: "New patient office visit (moderate)", category: "Visits" },
  { code: "99213", type: "CPT", label: "Established office visit (low)", category: "Visits" },
  { code: "99214", type: "CPT", label: "Established office visit (moderate)", category: "Visits" },
  { code: "99385", type: "CPT", label: "Preventive visit, 18–39", category: "Visits" },
  { code: "99283", type: "CPT", label: "ED visit (moderate)", category: "Emergency" },
  { code: "99284", type: "CPT", label: "ED visit (high)", category: "Emergency" },
  { code: "99285", type: "CPT", label: "ED visit (highest)", category: "Emergency" },
  { code: "90837", type: "CPT", label: "Psychotherapy, 60 min", category: "Behavioral" },
  { code: "90834", type: "CPT", label: "Psychotherapy, 45 min", category: "Behavioral" },
  { code: "97110", type: "CPT", label: "Physical therapy, exercise", category: "Therapy" },
  // Imaging
  { code: "70553", type: "CPT", label: "MRI brain w/ & w/o contrast", category: "Imaging" },
  { code: "72148", type: "CPT", label: "MRI lumbar spine w/o contrast", category: "Imaging" },
  { code: "73721", type: "CPT", label: "MRI knee/leg joint w/o contrast", category: "Imaging" },
  { code: "74177", type: "CPT", label: "CT abdomen & pelvis w/ contrast", category: "Imaging" },
  { code: "71046", type: "CPT", label: "Chest X-ray, 2 views", category: "Imaging" },
  { code: "77067", type: "CPT", label: "Screening mammogram", category: "Imaging" },
  { code: "76805", type: "CPT", label: "OB ultrasound", category: "Imaging" },
  { code: "93306", type: "CPT", label: "Echocardiogram", category: "Imaging" },
  // Lab & diagnostics
  { code: "80053", type: "CPT", label: "Comprehensive metabolic panel", category: "Lab" },
  { code: "85025", type: "CPT", label: "Complete blood count", category: "Lab" },
  { code: "80061", type: "CPT", label: "Lipid panel", category: "Lab" },
  { code: "83036", type: "CPT", label: "Hemoglobin A1c", category: "Lab" },
  { code: "93000", type: "CPT", label: "Electrocardiogram", category: "Lab" },
  // Procedures
  { code: "45378", type: "CPT", label: "Diagnostic colonoscopy", category: "Procedures" },
  { code: "45380", type: "CPT", label: "Colonoscopy with biopsy", category: "Procedures" },
  { code: "43239", type: "CPT", label: "Upper GI endoscopy with biopsy", category: "Procedures" },
  { code: "66984", type: "CPT", label: "Cataract removal with lens", category: "Procedures" },
  { code: "29881", type: "CPT", label: "Knee arthroscopy / meniscectomy", category: "Procedures" },
  { code: "47562", type: "CPT", label: "Laparoscopic gallbladder removal", category: "Procedures" },
  { code: "49505", type: "CPT", label: "Inguinal hernia repair", category: "Procedures" },
  { code: "27447", type: "CPT", label: "Total knee replacement", category: "Surgery" },
  { code: "27130", type: "CPT", label: "Total hip replacement", category: "Surgery" },
  { code: "59400", type: "CPT", label: "Vaginal delivery, global", category: "Maternity" },
  { code: "59510", type: "CPT", label: "Cesarean delivery, global", category: "Maternity" },
  // Inpatient
  { code: "470", type: "MS-DRG", label: "Major joint replacement (DRG 470)", category: "Inpatient" },
  { code: "807", type: "MS-DRG", label: "Vaginal delivery (DRG 807)", category: "Inpatient" },
  { code: "788", type: "MS-DRG", label: "Cesarean section (DRG 788)", category: "Inpatient" },
  { code: "871", type: "MS-DRG", label: "Sepsis w/ MCC (DRG 871)", category: "Inpatient" },
  { code: "291", type: "MS-DRG", label: "Heart failure w/ MCC (DRG 291)", category: "Inpatient" },
  { code: "392", type: "MS-DRG", label: "GI disorders (DRG 392)", category: "Inpatient" },
  { code: "194", type: "MS-DRG", label: "Pneumonia w/ CC (DRG 194)", category: "Inpatient" },
  { code: "247", type: "MS-DRG", label: "Coronary stent (DRG 247)", category: "Inpatient" },
  // APR-DRG (Massachusetts carriers pay inpatient on APR-DRG; rates come per severity level 1–4)
  { code: "302", type: "APR-DRG", label: "Knee joint replacement (APR 302)", category: "Inpatient" },
  { code: "301", type: "APR-DRG", label: "Hip joint replacement (APR 301)", category: "Inpatient" },
  { code: "560", type: "APR-DRG", label: "Vaginal delivery (APR 560)", category: "Inpatient" },
  { code: "540", type: "APR-DRG", label: "Cesarean delivery (APR 540)", category: "Inpatient" },
  { code: "720", type: "APR-DRG", label: "Septicemia (APR 720)", category: "Inpatient" },
  { code: "194", type: "APR-DRG", label: "Heart failure (APR 194)", category: "Inpatient" },
  { code: "139", type: "APR-DRG", label: "Other pneumonia (APR 139)", category: "Inpatient" },
  { code: "175", type: "APR-DRG", label: "PCI w/o AMI (APR 175)", category: "Inpatient" },
  { code: "640", type: "APR-DRG", label: "Normal newborn (APR 640)", category: "Inpatient" },
];

/** Normalizes billing_code_type: CPT and HCPCS share one code space; DRG variants are kept apart. */
export function codeKey(type: string, code: string) {
  const t = type.toUpperCase().replace(/\s/g, "");
  const norm = t === "CPT" || t === "HCPCS" ? "CPT" : t === "MS-DRG" || t === "MSDRG" || t === "DRG" ? "MS-DRG" : t === "APR-DRG" || t === "APRDRG" ? "APR-DRG" : t;
  let c = code.trim().toUpperCase();
  // APR-DRG is 3 digits; some carriers append severity of illness as a 4th digit ("3024" = APR 302, SOI 4).
  if (norm === "APR-DRG" && /^\d{4}$/.test(c) && /[1-4]$/.test(c)) c = c.slice(0, 3);
  return `${norm}|${norm.endsWith("DRG") && /^\d+$/.test(c) ? String(Number(c)).padStart(3, "0") : c}`;
}

export const benchCodeMap = (codes: BenchCode[] = BENCH_CODES) => new Map(codes.map((c) => [codeKey(c.type, c.code), c]));
