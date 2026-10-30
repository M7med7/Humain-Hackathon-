import type { Project, ProjectMember, Task } from "./api";
import type { ScheduleInfo } from "./schedule";
import { scoreProjectHealth } from "./riskScoring";

export type ExportFormat = "pdf" | "docx" | "csv" | "xlsx";

interface ExportContext {
  project: Project;
  tasks: Task[];
  members: ProjectMember[];
  scheduleMap: Map<string, ScheduleInfo>;
}

interface ExportTask {
  task: Task;
  assignee: string;
  start: string;
  due: string;
  steps: string[];
  acceptanceCriteria: string;
  definitionOfDone: string;
  blockers: string;
}

const FORMAT_META: Record<ExportFormat, { mime: string; extension: string }> = {
  pdf: { mime: "application/pdf", extension: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
  csv: { mime: "text/csv;charset=utf-8", extension: "csv" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
};

function cleanFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
}

function formatDate(date?: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function parseSteps(description: string | null): { summary: string; steps: string[] } {
  if (!description) return { summary: "", steps: [] };
  const parts = description.split(/\nSteps:\n|\nsteps:\n/i);
  const summary = (parts[0] ?? "").trim();
  const steps = (parts[1] ?? "")
    .split("\n")
    .map((step) => step.replace(/^\s*\d+[).]\s*/, "").trim())
    .filter(Boolean);
  return { summary, steps };
}

function memberName(member: ProjectMember): string {
  return member.full_name ?? member.email;
}

function taskAssignee(task: Task, members: ProjectMember[]): string {
  const member = members.find((item) => item.user_id === task.assigned_to);
  return member ? memberName(member) : "Unassigned";
}

function getExportTasks({ tasks, members, scheduleMap }: ExportContext): ExportTask[] {
  return tasks.map((task) => {
    const schedule = scheduleMap.get(task.id);
    const parsed = parseSteps(task.description);
    return {
      task,
      assignee: taskAssignee(task, members),
      start: formatDate(task.start_date ?? schedule?.start),
      due: formatDate(task.end_date ?? schedule?.end),
      steps: parsed.steps,
      acceptanceCriteria: (task.acceptance_criteria ?? []).map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`).join(" | "),
      definitionOfDone: (task.definition_of_done ?? []).map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`).join(" | "),
      blockers: (task.blocked_by ?? []).map((item) => `${item.title} (${item.status})`).join(", "),
    };
  });
}

function buildSummary(context: ExportContext) {
  const exportTasks = getExportTasks(context);
  const completed = context.tasks.filter((task) => task.status === "Done").length;
  const progress = context.tasks.length > 0 ? Math.round((completed / context.tasks.length) * 100) : 0;
  const projectRisk = scoreProjectHealth(context.project, context.tasks, context.members, context.scheduleMap);
  const blocked = context.tasks.filter((task) => task.is_blocked);
  const overdue = context.tasks.filter((task) => {
    const schedule = context.scheduleMap.get(task.id);
    return task.status !== "Done" && schedule ? schedule.end < new Date() : false;
  });
  const highPriorityOpen = context.tasks.filter((task) => task.priority === "High" && task.status !== "Done");
  const tech = Array.from(new Set(context.tasks.flatMap((task) => task.assigned_tech ?? []))).sort();
  const scheduledDates = Array.from(context.scheduleMap.values()).flatMap((item) => [item.start, item.end]);
  const minDate = scheduledDates.length ? new Date(Math.min(...scheduledDates.map((date) => date.getTime()))) : null;
  const maxDate = scheduledDates.length ? new Date(Math.max(...scheduledDates.map((date) => date.getTime()))) : null;
  const workload = context.members.map((member) => {
    const assigned = context.tasks.filter((task) => task.assigned_to === member.user_id);
    const estimated = assigned.reduce((sum, task) => sum + Number(task.estimated_days || 0), 0);
    const done = assigned.filter((task) => task.status === "Done").length;
    return {
      name: memberName(member),
      role: member.role,
      tasks: assigned.length,
      estimated,
      done,
    };
  });

  return {
    exportTasks,
    progress,
    completed,
    blocked,
    overdue,
    highPriorityOpen,
    tech,
    workload,
    timeline: minDate && maxDate ? `${formatDate(minDate)} - ${formatDate(maxDate)}` : "Not scheduled",
    risk: [
      `${projectRisk.level} risk (${100 - projectRisk.score}% health)`,
      ...projectRisk.reasons,
      overdue.length ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}` : "No overdue tasks",
      blocked.length ? `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"}` : "No blocked tasks",
      highPriorityOpen.length ? `${highPriorityOpen.length} open high-priority task${highPriorityOpen.length === 1 ? "" : "s"}` : "No open high-priority tasks",
    ],
    riskActions: projectRisk.actions,
  };
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeCsv(context: ExportContext): Blob {
  const rows = [
    ["Project", context.project.name],
    ["Description", context.project.description],
    ["Progress", `${buildSummary(context).progress}%`],
    [],
    ["Task", "Status", "Priority", "Assignee", "Estimated days", "Start date", "Due date", "Technologies", "Blocked by", "Acceptance criteria", "Definition of done", "Implementation steps"],
    ...getExportTasks(context).map((item) => [
      item.task.title,
      item.task.status,
      item.task.priority,
      item.assignee,
      item.task.estimated_days,
      item.start,
      item.due,
      (item.task.assigned_tech ?? []).join(", "),
      item.blockers,
      item.acceptanceCriteria,
      item.definitionOfDone,
      item.steps.join(" | "),
    ]),
  ];
  return new Blob([rows.map((row) => row.map(escapeCsv).join(",")).join("\n")], { type: FORMAT_META.csv.mime });
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function u16(value: number): number[] {
  return [value & 255, (value >>> 8) & 255];
}

function u32(value: number): number[] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function zip(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(checksum), ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0),
    ]);
    const centralHeader = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(checksum), ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    localParts.push(localHeader, name, content);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const totalLength = offset + centralSize + end.length;
  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function bytesToBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function makeXlsx(context: ExportContext): Blob {
  const summary = buildSummary(context);
  const rows = [
    ["Project", context.project.name],
    ["Description", context.project.description],
    ["Timeline", summary.timeline],
    ["Progress", `${summary.progress}% (${summary.completed}/${context.tasks.length} tasks)`],
    ["Risks", summary.risk.join("; ")],
    ["Risk actions", summary.riskActions.join("; ")],
    [],
    ["Task", "Status", "Priority", "Assignee", "Estimated days", "Start date", "Due date", "Technologies", "Blocked by", "Acceptance criteria", "Definition of done", "Implementation steps"],
    ...summary.exportTasks.map((item) => [
      item.task.title,
      item.task.status,
      item.task.priority,
      item.assignee,
      item.task.estimated_days,
      item.start,
      item.due,
      (item.task.assigned_tech ?? []).join(", "),
      item.blockers,
      item.acceptanceCriteria,
      item.definitionOfDone,
      item.steps.join(" | "),
    ]),
    [],
    ["Team member", "Role", "Assigned tasks", "Done", "Estimated days"],
    ...summary.workload.map((item) => [item.name, item.role, item.tasks, item.done, item.estimated]),
  ];
  const sheetData = rows.map((row, index) => `<row r="${index + 1}">${row.map((cell, cellIndex) => {
    const column = String.fromCharCode(65 + cellIndex);
    return `<c r="${column}${index + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const files = [
    { path: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { path: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { path: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Project Export" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { path: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { path: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>` },
  ];
  return new Blob([bytesToBlobPart(zip(files))], { type: FORMAT_META.xlsx.mime });
}

function docParagraph(text: string, bold = false): string {
  return `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function docTable(rows: string[][]): string {
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

function makeDocx(context: ExportContext): Blob {
  const summary = buildSummary(context);
  const body = [
    docParagraph(context.project.name, true),
    docParagraph(context.project.description),
    docParagraph(`Timeline: ${summary.timeline}`),
    docParagraph(`Progress: ${summary.progress}% (${summary.completed}/${context.tasks.length} tasks)`),
    docParagraph("Risk Summary", true),
    ...summary.risk.map((item) => docParagraph(item)),
    docParagraph("Risk Actions", true),
    ...summary.riskActions.map((item) => docParagraph(item)),
    docParagraph("Suggested Technologies", true),
    docParagraph(summary.tech.length ? summary.tech.join(", ") : "No technologies listed."),
    docParagraph("Team Capacity Summary", true),
    docTable([["Team member", "Role", "Assigned tasks", "Done", "Estimated days"], ...summary.workload.map((item) => [item.name, item.role, String(item.tasks), String(item.done), String(item.estimated)])]),
    docParagraph("Tasks", true),
    docTable([["Task", "Status", "Priority", "Assignee", "Estimate", "Start", "Due", "Blocked by"], ...summary.exportTasks.map((item) => [item.task.title, item.task.status, item.task.priority, item.assignee, `${item.task.estimated_days}d`, item.start, item.due, item.blockers])]),
    docParagraph("Acceptance Criteria", true),
    ...summary.exportTasks.flatMap((item) => [docParagraph(item.task.title, true), ...(item.acceptanceCriteria ? item.acceptanceCriteria.split(" | ").map((criterion) => docParagraph(criterion)) : [docParagraph("No criteria listed.")])]),
    docParagraph("Definition of Done", true),
    ...summary.exportTasks.flatMap((item) => [docParagraph(item.task.title, true), ...(item.definitionOfDone ? item.definitionOfDone.split(" | ").map((criterion) => docParagraph(criterion)) : [docParagraph("No done checks listed.")])]),
    docParagraph("Implementation Steps", true),
    ...summary.exportTasks.flatMap((item) => [docParagraph(item.task.title, true), ...(item.steps.length ? item.steps.map((step) => docParagraph(`- ${step}`)) : [docParagraph("No steps listed.")])]),
  ].join("");
  const files = [
    { path: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { path: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { path: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>` },
  ];
  return new Blob([bytesToBlobPart(zip(files))], { type: FORMAT_META.docx.mime });
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(text: string, max = 86): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function makePdf(context: ExportContext): Blob {
  const summary = buildSummary(context);
  const lines = [
    context.project.name,
    `Description: ${context.project.description}`,
    `Timeline: ${summary.timeline}`,
    `Progress: ${summary.progress}% (${summary.completed}/${context.tasks.length} tasks)`,
    `Suggested technologies: ${summary.tech.length ? summary.tech.join(", ") : "No technologies listed."}`,
    `Risk summary: ${summary.risk.join("; ")}`,
    `Risk actions: ${summary.riskActions.join("; ")}`,
    "",
    "Team Capacity",
    ...summary.workload.map((item) => `${item.name} (${item.role}) - ${item.tasks} tasks, ${item.done} done, ${item.estimated} estimated days`),
    "",
    "Tasks",
    ...summary.exportTasks.flatMap((item) => [
      `${item.task.title} | ${item.task.status} | ${item.task.priority} | ${item.assignee} | ${item.task.estimated_days}d | ${item.start} - ${item.due}`,
      item.blockers ? `Blocked by: ${item.blockers}` : "Blocked by: None",
      item.acceptanceCriteria ? `Acceptance: ${item.acceptanceCriteria}` : "Acceptance: No criteria listed.",
      item.definitionOfDone ? `Done: ${item.definitionOfDone}` : "Done: No checks listed.",
      item.steps.length ? `Steps: ${item.steps.join("; ")}` : "Steps: No steps listed.",
      "",
    ]),
  ].flatMap((line) => wrapText(line));

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 45) pages.push(lines.slice(i, i + 45));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const pageRefs: string[] = [];
  const fontObjectId = 3 + pages.length * 2;
  pages.forEach((pageLines, pageIndex) => {
    const content = `BT /F1 11 Tf 50 780 Td 14 TL ${pageLines.map((line) => `(${escapePdfText(line)}) Tj T*`).join(" ")} ET`;
    const contentId = 3 + pageIndex * 2;
    const pageId = 4 + pageIndex * 2;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageRefs.push(`${pageId} 0 R`);
  });
  objects.splice(1, 0, `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: FORMAT_META.pdf.mime });
}

export function exportProject(context: ExportContext, format: ExportFormat) {
  const makers: Record<ExportFormat, (ctx: ExportContext) => Blob> = {
    pdf: makePdf,
    docx: makeDocx,
    csv: makeCsv,
    xlsx: makeXlsx,
  };
  const blob = makers[format](context);
  const meta = FORMAT_META[format];
  downloadBlob(blob, `${cleanFileName(context.project.name)}-export.${meta.extension}`);
}
